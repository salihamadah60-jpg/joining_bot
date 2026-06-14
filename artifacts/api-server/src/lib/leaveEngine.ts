/**
 * LEAVE ENGINE — completely independent from the join engine.
 *
 * Responsibilities:
 *   1. leaveGroupsBatch()  — manual batch-leave called from API
 *   2. autoCleanupAccount() — for channels_limit accounts: leave non-medical groups
 *   3. startLeaveEngine()  — periodic background loop (every 10 min)
 *
 * Runs on its own interval, does NOT block or share timers with telegramEngine.
 */

import { ObjectId } from "mongodb";
import { collections } from "@workspace/db";
import { logger } from "./logger.js";
import { getClient } from "./clientPool.js";
import { isRelevantGroupAsync } from "./groupFilter.js";
import { eventBus } from "./eventBus.js";
import { getDeviceProfileForPhone } from "./deviceProfiles.js";

export interface LeaveTarget {
  url?: string | null;
  username?: string | null;
  chatId?: string;
  title?: string | null;
  chatType?: string | null;
}

export interface LeaveResult {
  url: string;
  title: string | null;
  ok: boolean;
  error?: string;
}

let leaveTimer: NodeJS.Timeout | null = null;
let leaveRunning = false;

// ─── Core: leave a single group on a client ───────────────────────────────────

async function leaveSingle(
  client: any,
  target: LeaveTarget
): Promise<{ ok: boolean; error?: string }> {
  const peer = target.username || target.url;
  if (!peer) {
    return { ok: false, error: "No username or URL available to leave" };
  }
  try {
    await (client as any).leaveChat(peer);
    return { ok: true };
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    return { ok: false, error: msg };
  }
}

// ─── Public: batch leave (called from API route) ──────────────────────────────

export async function leaveGroupsBatch(
  phone: string,
  targets: LeaveTarget[],
  reason: string = "manual"
): Promise<{ success: number; failed: number; results: LeaveResult[] }> {
  const accountsCol = await collections.accounts();
  const account = await accountsCol.findOne({ phone });
  if (!account) throw new Error(`Account ${phone} not found`);
  if (!account.sessionString) throw new Error(`Account ${phone} has no active session`);

  const deviceProfile = account.deviceModel
    ? {
        deviceModel: account.deviceModel ?? undefined,
        systemVersion: account.systemVersion ?? undefined,
        appVersion: account.appVersion ?? undefined,
        systemLangCode: account.systemLangCode ?? "ar",
        langPack: "tdesktop",
      }
    : getDeviceProfileForPhone(phone);

  const client = await getClient(phone, account.sessionString, deviceProfile);

  const leftCol = await collections.leftGroups();
  const syncedCol = await collections.syncedDialogs();

  const results: LeaveResult[] = [];
  let success = 0;
  let failed = 0;

  for (const target of targets) {
    const displayUrl = target.url || target.username || target.chatId || "?";
    const result = await leaveSingle(client, target);

    if (result.ok) {
      success++;
      // Save to left_groups history
      try {
        await leftCol.insertOne({
          _id: new ObjectId(),
          url: target.url ?? target.username ?? "",
          accountPhone: phone,
          title: target.title ?? null,
          chatType: target.chatType ?? null,
          reason,
          leftAt: new Date(),
        });
      } catch {}

      // Remove from synced_dialogs
      if (target.chatId) {
        try {
          await syncedCol.deleteOne({ accountPhone: phone, chatId: target.chatId });
        } catch {}
      }

      // Decrement channelsCount
      await accountsCol.updateOne(
        { phone },
        { $inc: { channelsCount: -1 }, $set: { updatedAt: new Date() } }
      );

      const msg = `🚪 مغادرة (${reason}): ${target.title ?? displayUrl} [${phone}]`;
      await logLeaveActivity(msg, phone, target.url ?? "");
      eventBus.publish({
        type: "left_group",
        message: msg,
        accountPhone: phone,
        linkUrl: target.url ?? "",
        timestamp: new Date().toISOString(),
      });
    } else {
      failed++;
      logger.warn({ phone, url: displayUrl, error: result.error }, "Failed to leave group");
    }

    results.push({
      url: displayUrl,
      title: target.title ?? null,
      ok: result.ok,
      error: result.error,
    });

    // Small delay between leaves (human-like)
    await sleep(1500 + Math.random() * 2000);
  }

  // After leaving, check if account can resume joining
  const updated = await accountsCol.findOne({ phone });
  if (updated && updated.status === "channels_limit" && (updated.channelsCount ?? 500) < 450) {
    await accountsCol.updateOne(
      { phone },
      { $set: { status: "active", updatedAt: new Date() } }
    );
    const reactivateMsg = `✅ تم تفعيل الحساب ${phone} — المساحة متاحة للانضمام من جديد`;
    await logLeaveActivity(reactivateMsg, phone, "");
    eventBus.publish({
      type: "account_reactivated",
      message: reactivateMsg,
      accountPhone: phone,
      timestamp: new Date().toISOString(),
    });
    logger.info({ phone }, "Account reactivated after group cleanup");
  }

  return { success, failed, results };
}

// ─── Auto cleanup: for channels_limit accounts ───────────────────────────────

export async function autoCleanupAccount(phone: string): Promise<{
  checked: number;
  left: number;
  reactivated: boolean;
}> {
  const accountsCol = await collections.accounts();
  const account = await accountsCol.findOne({ phone });
  if (!account) throw new Error(`Account ${phone} not found`);
  if (!account.sessionString) throw new Error(`Account ${phone} has no active session`);

  const syncedCol = await collections.syncedDialogs();
  const dialogs = await syncedCol.find({ accountPhone: phone }).toArray();

  if (dialogs.length === 0) {
    return { checked: 0, left: 0, reactivated: false };
  }

  const toLeave: LeaveTarget[] = [];

  for (const dialog of dialogs) {
    const relevant = await isRelevantGroupAsync(dialog.title, null, []);
    if (relevant === false) {
      toLeave.push({
        url: dialog.url ?? undefined,
        username: dialog.username ?? undefined,
        chatId: dialog.chatId,
        title: dialog.title,
        chatType: dialog.chatType,
      });
    }
  }

  if (toLeave.length === 0) {
    return { checked: dialogs.length, left: 0, reactivated: false };
  }

  const { success } = await leaveGroupsBatch(phone, toLeave, "auto_cleanup");

  const updated = await accountsCol.findOne({ phone });
  const reactivated = updated?.status === "active";

  logger.info({ phone, checked: dialogs.length, left: success, reactivated }, "Auto-cleanup complete");
  return { checked: dialogs.length, left: success, reactivated };
}

// ─── Background scheduler ─────────────────────────────────────────────────────

export function startLeaveEngine(): void {
  if (leaveRunning) return;
  leaveRunning = true;
  scheduleLeaveTick(60_000);
  logger.info("Leave engine started (10-minute cycle)");
}

export function stopLeaveEngine(): void {
  leaveRunning = false;
  if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; }
}

function scheduleLeaveTick(delayMs: number): void {
  if (leaveTimer) clearTimeout(leaveTimer);
  leaveTimer = setTimeout(() => {
    leaveTick().catch((err) => {
      logger.error({ err }, "Leave engine tick error");
    }).finally(() => {
      if (leaveRunning) scheduleLeaveTick(10 * 60_000);
    });
  }, delayMs);
}

async function leaveTick(): Promise<void> {
  const accountsCol = await collections.accounts();
  const limitAccounts = await accountsCol.find({ status: "channels_limit" }).toArray();

  if (limitAccounts.length === 0) return;

  logger.info({ count: limitAccounts.length }, "Leave engine: processing channels_limit accounts");

  for (const acc of limitAccounts) {
    if (!acc.sessionString) continue;
    try {
      const result = await autoCleanupAccount(acc.phone);
      logger.info(result, `Leave engine: cleanup done for ${acc.phone}`);
    } catch (e) {
      logger.warn({ phone: acc.phone, err: e }, "Leave engine: cleanup failed for account");
    }
    // Pause between accounts
    await sleep(5000);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function logLeaveActivity(message: string, phone: string, url: string): Promise<void> {
  try {
    const col = await collections.activityLog();
    await col.insertOne({
      _id: new ObjectId(),
      type: "left_group",
      message,
      accountPhone: phone,
      linkUrl: url || null,
      errorCode: null,
      waitSeconds: null,
      createdAt: new Date(),
    });
  } catch {}
}
