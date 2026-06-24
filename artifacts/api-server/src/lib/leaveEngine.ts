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
import type { LeaveQueueDoc } from "@workspace/db";
import { logger } from "./logger.js";
import { getClient, getPooledClientOnly, removeClient } from "./clientPool.js";
import { isRelevantGroupAsync, isHardBlocked } from "./groupFilter.js";
import { parseJoinTarget } from "./telegramEngine.js";
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

// ─── Leave Queue processor state (per-account timers) ─────────────────────────
const queueTimers = new Map<string, NodeJS.Timeout>();
// Safe interval between leaves per account: 50-100 seconds with jitter
const LEAVE_QUEUE_BASE_MS = 50_000;
const LEAVE_QUEUE_JITTER_MS = 50_000;

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

// ─── Get client with AUTH_KEY_DUPLICATED retry ─────────────────────────────

export async function getClientWithRetry(
  phone: string,
  sessionString: string,
  deviceProfile: any
): Promise<TelegramClient> {
  // Always prefer the existing pooled client (avoids AUTH_KEY_DUPLICATED entirely)
  const pooled = getPooledClientOnly(phone);
  if (pooled) {
    logger.debug({ phone }, "Leave engine reusing pooled client");
    return pooled;
  }

  try {
    return await getClient(phone, sessionString, deviceProfile);
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    if (msg.includes("AUTH_KEY_DUPLICATED")) {
      logger.warn(
        { phone },
        "AUTH_KEY_DUPLICATED — removing stale client, waiting 35s before retry"
      );
      await removeClient(phone);
      await sleep(35_000);
      return await getClient(phone, sessionString, deviceProfile);
    }
    throw e;
  }
}

// Import type for TypeScript
import type { TelegramClient } from "@mtcute/node";

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

  const client = await getClientWithRetry(phone, account.sessionString, deviceProfile);

  const leftCol = await collections.leftGroups();
  const syncedCol = await collections.syncedDialogs();

  const results: LeaveResult[] = [];
  let success = 0;
  let failed = 0;

  for (const target of targets) {
    const displayUrl = target.url || target.username || target.chatId || "?";
    const result = await leaveSingle(client, target);

    // If AUTH_KEY_DUPLICATED mid-batch, stop early and surface the error
    if (!result.ok && result.error?.includes("AUTH_KEY_DUPLICATED")) {
      logger.warn(
        { phone, url: displayUrl },
        "AUTH_KEY_DUPLICATED mid-batch — stopping leave operation"
      );
      results.push({ url: displayUrl, title: target.title ?? null, ok: false, error: result.error });
      failed++;
      break;
    }

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

  // After leaving, if account was channels_limit and we successfully freed space,
  // set it back to active. Telegram — not internal counters — will re-set it to
  // channels_limit on the next join attempt if it's still full.
  if (success > 0) {
    const updated = await accountsCol.findOne({ phone });
    if (updated && updated.status === "channels_limit") {
      await accountsCol.updateOne(
        { phone },
        { $set: { status: "active", updatedAt: new Date() } }
      );
      const reactivateMsg = `✅ تم تفعيل الحساب ${phone} — تم تحرير ${success} مجموعة، جاهز للانضمام من جديد`;
      await logLeaveActivity(reactivateMsg, phone, "");
      eventBus.publish({
        type: "account_reactivated",
        message: reactivateMsg,
        accountPhone: phone,
        timestamp: new Date().toISOString(),
      });
      logger.info({ phone, freed: success }, "Account reactivated after manual group cleanup");
    }
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

// ═══════════════════════════════════════════════════════════════════════════════
// LEAVE QUEUE — persistent per-account sequential leave processor
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Add items to the persistent leave queue for an account.
 * Duplicate items (same chatId or url already pending/processing) are skipped.
 * Returns { added, existing } counts.
 */
export async function addToLeaveQueue(
  accountPhone: string,
  items: LeaveTarget[],
  reason = "manual"
): Promise<{ added: number; existing: number }> {
  const qCol = await collections.leaveQueue();
  let added = 0;
  let existing = 0;

  for (const item of items) {
    if (!item.chatId && !item.url && !item.username) continue;

    // Dedup check: is this item already in the queue (pending or processing)?
    const orClauses: Record<string, unknown>[] = [];
    if (item.chatId) orClauses.push({ chatId: item.chatId });
    if (item.url) orClauses.push({ url: item.url });

    const alreadyQueued = orClauses.length
      ? await qCol.findOne({
          accountPhone,
          $or: orClauses as any,
          status: { $in: ["pending", "processing"] },
        })
      : null;

    if (alreadyQueued) { existing++; continue; }

    await qCol.insertOne({
      _id: new ObjectId(),
      accountPhone,
      url: item.url ?? null,
      username: item.username ?? null,
      chatId: item.chatId ?? null,
      title: item.title ?? null,
      chatType: item.chatType ?? null,
      reason,
      status: "pending",
      errorMessage: null,
      addedAt: new Date(),
      processedAt: null,
    });
    added++;
  }

  // Kick off the queue processor for this account if we added items
  if (added > 0) scheduleQueueTick(accountPhone, 2_000);

  return { added, existing };
}

/**
 * Get the current queue for one account.
 */
export async function getLeaveQueue(
  accountPhone: string
): Promise<LeaveQueueDoc[]> {
  const qCol = await collections.leaveQueue();
  return qCol.find({ accountPhone }).sort({ addedAt: 1 }).toArray();
}

/**
 * Clear all pending (unprocessed) items from an account's queue.
 */
export async function clearLeaveQueue(accountPhone: string): Promise<number> {
  const qCol = await collections.leaveQueue();
  const result = await qCol.deleteMany({ accountPhone, status: "pending" });
  return result.deletedCount;
}

/**
 * Remove a single item from the queue by its _id string.
 */
export async function removeLeaveQueueItem(id: string): Promise<boolean> {
  const qCol = await collections.leaveQueue();
  const result = await qCol.deleteOne({ _id: new ObjectId(id), status: "pending" });
  return result.deletedCount > 0;
}

/**
 * Start the leave queue processor on server boot.
 * Resumes any accounts that had pending items when the server last stopped.
 */
export async function startLeaveQueueProcessor(): Promise<void> {
  const qCol = await collections.leaveQueue();

  // Reset any items stuck in "processing" (interrupted by server restart)
  await qCol.updateMany({ status: "processing" }, { $set: { status: "pending" } });

  // Schedule a tick for every account with pending items
  const phones = await qCol.distinct("accountPhone", { status: "pending" });
  for (const phone of phones) {
    scheduleQueueTick(phone as string, 5_000 + Math.random() * 10_000);
  }
  logger.info({ accounts: phones.length }, "Leave queue processor started");
}

/**
 * Trigger the leave queue for a specific account to process immediately.
 * Used when the user clicks "بدء المغادرة فوراً".
 */
export function triggerLeaveNow(phone: string): void {
  scheduleQueueTick(phone, 500);
}

// ─── Internal queue scheduler ─────────────────────────────────────────────────

function scheduleQueueTick(phone: string, delayMs?: number): void {
  const existing = queueTimers.get(phone);
  if (existing) clearTimeout(existing);

  const jitter = Math.random() * LEAVE_QUEUE_JITTER_MS;
  const delay = delayMs ?? LEAVE_QUEUE_BASE_MS + jitter;

  const t = setTimeout(() => {
    processNextQueueItem(phone)
      .catch((err) => logger.warn({ phone, err }, "Leave queue tick error"))
      .finally(async () => {
        // Re-schedule if more pending items exist
        const qCol = await collections.leaveQueue();
        const remaining = await qCol.countDocuments({ accountPhone: phone, status: "pending" });
        if (remaining > 0) scheduleQueueTick(phone);
        else queueTimers.delete(phone);
      });
  }, delay);

  queueTimers.set(phone, t);
}

async function processNextQueueItem(phone: string): Promise<void> {
  const qCol = await collections.leaveQueue();

  // Atomically pick the oldest pending item and mark as "processing"
  const item = await qCol.findOneAndUpdate(
    { accountPhone: phone, status: "pending" },
    { $set: { status: "processing" } },
    { sort: { addedAt: 1 }, returnDocument: "after" }
  );
  if (!item) return; // Queue empty

  const accountsCol = await collections.accounts();
  const account = await accountsCol.findOne({ phone });

  if (!account?.sessionString) {
    // Account has no session — put item back and stop
    await qCol.updateOne({ _id: item._id }, { $set: { status: "pending" } });
    logger.warn({ phone }, "Leave queue: account has no session — pausing queue");
    return;
  }

  let client: any;
  try {
    const dp = getDeviceProfileForPhone(phone);
    client = await getClientWithRetry(phone, account.sessionString, dp);
  } catch (e: any) {
    await qCol.updateOne(
      { _id: item._id },
      { $set: { status: "failed", errorMessage: `Client error: ${e?.message}`, processedAt: new Date() } }
    );
    logger.warn({ phone, err: e }, "Leave queue: failed to get client");
    return;
  }

  const target: LeaveTarget = {
    url: item.url ?? undefined,
    username: item.username ?? undefined,
    chatId: item.chatId ?? undefined,
    title: item.title ?? undefined,
    chatType: item.chatType ?? undefined,
  };

  const result = await leaveSingle(client, target);

  if (result.ok) {
    await qCol.updateOne(
      { _id: item._id },
      { $set: { status: "done", processedAt: new Date() } }
    );

    // Log to left_groups history
    const leftGroupsCol = await collections.leftGroups();
    await leftGroupsCol.insertOne({
      _id: new ObjectId(),
      url: item.url ?? item.username ?? item.chatId ?? "",
      accountPhone: phone,
      title: item.title ?? null,
      chatType: item.chatType ?? null,
      reason: `${item.reason} (queue)`,
      leftAt: new Date(),
    });

    // Remove from synced dialogs
    if (item.chatId) {
      const syncedCol = await collections.syncedDialogs();
      await syncedCol.deleteOne({ accountPhone: phone, chatId: item.chatId });
    }

    // Update account channelsCount
    await accountsCol.updateOne(
      { phone },
      { $inc: { channelsCount: -1 }, $set: { updatedAt: new Date() } }
    );

    const title = item.title ?? item.url ?? item.chatId ?? "?";
    logger.info({ phone, title }, "Leave queue: item processed ✅");
    eventBus.publish({
      type: "left_group",
      message: `🚪 غادر (طابور): ${title}`,
      accountPhone: phone,
      linkUrl: item.url ?? undefined,
      timestamp: new Date().toISOString(),
    });

    // If account was channels_limit, reactivate it so the engine can
    // try joining again. Telegram will re-set channels_limit if still full.
    const updatedAcc = await accountsCol.findOne({ phone });
    if (updatedAcc && updatedAcc.status === "channels_limit") {
      await accountsCol.updateOne(
        { phone },
        { $set: { status: "active", updatedAt: new Date() } }
      );
      eventBus.publish({
        type: "account_reactivated",
        message: `✅ تم تفعيل الحساب ${phone} بعد مغادرة مجموعة من الطابور`,
        accountPhone: phone,
        timestamp: new Date().toISOString(),
      });
      logger.info({ phone }, "Account reactivated after queue leave");
    }

  } else {
    const errorMsg = result.error ?? "unknown error";

    // Detect FLOOD_WAIT — pause this account's queue for the required duration
    const floodMatch = errorMsg.match(/FLOOD_WAIT[_\s]?(\d+)/i);
    if (floodMatch) {
      const waitSecs = Number(floodMatch[1]) + 30; // buffer
      logger.warn({ phone, waitSecs }, "Leave queue: FLOOD_WAIT — pausing queue");
      await qCol.updateOne({ _id: item._id }, { $set: { status: "pending" } });
      scheduleQueueTick(phone, waitSecs * 1_000);
      return;
    }

    // Permanent or transient failure
    await qCol.updateOne(
      { _id: item._id },
      { $set: { status: "failed", errorMessage: errorMsg, processedAt: new Date() } }
    );
    logger.warn({ phone, title: item.title, error: errorMsg }, "Leave queue: item failed ❌");
  }
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
  // This tick NO LONGER performs automatic group leaving.
  // Leaving groups is a MANUAL operation — the user selects groups on the
  // Channels page and triggers leave themselves.
  //
  // The tick is kept for the prefetch job only: use channels_limit accounts
  // (which are full and can't join anyway) to pre-resolve pending link titles,
  // allowing non-relevant links to be skipped before active accounts waste
  // their daily quota on them.

  const accountsCol = await collections.accounts();
  const limitAccounts = await accountsCol.find({ status: "channels_limit" }).toArray();
  if (limitAccounts.length === 0) return;

  for (const acc of limitAccounts) {
    if (!acc.sessionString) continue;
    try {
      await prefetchPendingLinks(acc.phone, acc.sessionString);
    } catch (e) {
      logger.debug({ phone: acc.phone, err: e }, "Prefetch: failed for account (non-fatal)");
    }
    break; // One account is enough per tick
  }
}

/**
 * Use a channels_limit account to resolve pending username-based links WITHOUT joining.
 * For each link with no groupTitle: try to get the entity via @mtcute client,
 * run the relevance filter, and mark clearly-irrelevant links as "skipped" immediately.
 * Only public username links can be pre-checked; invite-hash links are left as pending.
 */
async function prefetchPendingLinks(phone: string, sessionString: string): Promise<void> {
  const linksCol = await collections.targetLinks();

  // Get pending links that haven't been prefetched yet (no groupTitle saved)
  const pending = await linksCol
    .find({ status: "pending", groupTitle: { $exists: false } })
    .limit(30)
    .toArray();

  if (pending.length === 0) return;

  const deviceProfile = getDeviceProfileForPhone(phone);
  const client = await getClient(phone, sessionString, deviceProfile);

  let prefetched = 0;
  let skipped = 0;

  for (const link of pending) {
    const target = parseJoinTarget(link.url);

    // Skip invite-hash links (can't resolve without joining)
    if (target.startsWith("+") || target.includes("joinchat")) continue;
    // Skip non-username targets
    if (!target || target.startsWith("http")) continue;

    try {
      // Try to get entity info without joining.
      // @mtcute exposes resolveUsername → returns a Chat-like object with title and type.
      let title: string | null = null;
      let chatType: string | null = null;

      try {
        const entity = await (client as any).resolveUsername(target);
        title = entity?.title ?? entity?.firstName ?? null;
        chatType = String(entity?.chatType ?? entity?.type ?? "");
      } catch {
        // resolveUsername failed — link stays as pending (normal join flow)
        continue;
      }

      if (!title) continue;

      const relevant = await isRelevantGroupAsync(title);

      if (relevant === false) {
        // Clearly not in scope — skip it now without ever joining
        await linksCol.updateOne(
          { _id: link._id },
          {
            $set: {
              status: "skipped",
              groupTitle: title,
              groupType: chatType,
              failReason: "not_in_scope_prefetch",
              processedAt: new Date(),
            },
          }
        );
        skipped++;
        logger.info({ url: link.url, title }, "Prefetch: link skipped (not in scope)");
      } else {
        // Relevant or uncertain — save the title so join engine doesn't re-fetch
        await linksCol.updateOne(
          { _id: link._id },
          { $set: { groupTitle: title, groupType: chatType } }
        );
        prefetched++;
      }

      await sleep(300);
    } catch (e) {
      logger.debug({ url: link.url, err: e }, "Prefetch: could not resolve link (non-fatal)");
    }
  }

  if (prefetched + skipped > 0) {
    logger.info({ prefetched, skipped }, `Prefetch: resolved ${prefetched + skipped} links via ${phone}`);
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
