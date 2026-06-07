/**
 * BOT ENGINE — CORE SCHEDULER
 *
 * The engine is a singleton that:
 *  1. Reads bot state from DB to decide if running
 *  2. Schedules join actions with safe account-count-aware intervals
 *  3. Rotates accounts in a round-robin queue
 *  4. Handles ALL Telegram errors gracefully
 *  5. Enforces daily limits and blackout hours (2–8 AM)
 *  6. Logs every action to activity_log
 *
 * TIMING SAFETY (see timing.ts):
 *  Target: 80–90 joins / account / 18 active hours
 *  ≈ 1 join every 17.2 min per account (with 35% safety buffer + ±25% jitter)
 */

import { eq, and } from "drizzle-orm";
import {
  db,
  botStateTable,
  accountsTable,
  groupLinksTable,
  activityLogTable,
  settingsTable,
} from "@workspace/db";
import type { Account } from "@workspace/db";
import { logger } from "./logger.js";
import {
  computeActionIntervalMs,
  isBlackoutHour,
  msUntilBlackoutEnd,
  isBlackoutHourConfigurable,
  msUntilActiveStartConfigurable,
  floodWaitMs,
  shouldResetDailyCounter,
  DAILY_LIMIT,
} from "./timing.js";
import { classifyTelegramError } from "./telegramErrors.js";
import { isRelevantGroup, isRelevantGroupAsync, categorizeChatType, observeGroupAfterJoin } from "./groupFilter.js";
import { getClient, removeClient } from "./clientPool.js";
import { getDeviceProfileForPhone } from "./deviceProfiles.js";
import { eventBus } from "./eventBus.js";

let timer: NodeJS.Timeout | null = null;
let engineRunning = false;
let accountIndex = 0;

// ─── Public API ─────────────────────────────────────────────────────────────────

/**
 * Called once when the API server starts.
 * If the bot was running before a restart, it resumes automatically.
 */
export async function engineInit(): Promise<void> {
  const [state] = await db.select().from(botStateTable).limit(1);
  if (state?.running) {
    logger.info("Bot was running before restart — resuming engine");
    engineRunning = true;
    scheduleNext(3000);
  }
}

export async function engineStart(): Promise<void> {
  if (engineRunning) return;
  engineRunning = true;
  scheduleNext(1000);
  logger.info("Bot engine started");
  eventBus.publish({
    type: "engine_started",
    message: "▶️ تم تشغيل البوت",
    timestamp: new Date().toISOString(),
  });
}

export async function engineStop(): Promise<void> {
  engineRunning = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  logger.info("Bot engine stopped");
  eventBus.publish({
    type: "engine_stopped",
    message: "⏸ تم إيقاف البوت",
    timestamp: new Date().toISOString(),
  });
}

export function engineIsRunning(): boolean {
  return engineRunning;
}

// ─── Scheduler ──────────────────────────────────────────────────────────────────

function scheduleNext(delayMs: number): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    tick().catch((err) => {
      logger.error({ err }, "Unhandled engine tick error");
      if (engineRunning) scheduleNext(30_000);
    });
  }, delayMs);
}

async function tick(): Promise<void> {
  if (!engineRunning) return;

  try {
    // Re-check DB in case it was changed externally (e.g., from dashboard Stop button)
    const [state] = await db.select().from(botStateTable).limit(1);
    if (!state?.running) {
      engineRunning = false;
      return;
    }

    // ── P2-3: Configurable sleep schedule ──
    // Read active_start_hour from settings (default 8 = 8am if not set)
    const settingsRows = await db.select().from(settingsTable);
    const settingsKv: Record<string, string> = {};
    for (const r of settingsRows) settingsKv[r.key] = r.value;
    const activeStartHour = Number(settingsKv["active_start_hour"] ?? 8);

    // P3-1: Sync AI filter enabled state from settings
    const { setAiFilterEnabled } = await import("./aiFilter.js");
    const aiEnabled = settingsKv["ai_filter_enabled"] === "true" ||
      (settingsKv["ai_filter_enabled"] === undefined && !!process.env["GEMINI_API_KEY"]);
    setAiFilterEnabled(aiEnabled);

    if (isBlackoutHourConfigurable(activeStartHour)) {
      const waitMs = msUntilActiveStartConfigurable(activeStartHour);
      const endHour = (activeStartHour + 18) % 24;
      logger.info({ waitMinutes: Math.ceil(waitMs / 60_000), activeStartHour, endHour }, "Blackout window — pausing");
      await logActivity("bot_stopped", `⏸ وقت الراحة — ينتهي الساعة ${activeStartHour}:00`);
      scheduleNext(waitMs);
      return;
    }

    // ── Get active accounts ──
    const allActive = await db
      .select()
      .from(accountsTable)
      .where(eq(accountsTable.status, "active"));

    const now = new Date();

    // Reset daily counters for accounts that are in a new day
    for (const acc of allActive) {
      if (shouldResetDailyCounter(acc.dailyResetAt)) {
        await db
          .update(accountsTable)
          .set({ joinedToday: 0, dailyResetAt: now })
          .where(eq(accountsTable.id, acc.id));
        acc.joinedToday = 0;
        acc.dailyResetAt = now;
      }
    }

    // Filter usable accounts (not flood-waited, not at daily limit)
    const usable = allActive.filter((acc) => {
      if (acc.joinedToday >= acc.dailyLimit) return false;
      if (acc.floodWaitUntil && acc.floodWaitUntil > now) return false;
      return true;
    });

    if (usable.length === 0) {
      // All accounts exhausted — check again in 5 min
      scheduleNext(5 * 60_000);
      return;
    }

    // ── Compute safe interval ──
    const intervalMs = computeActionIntervalMs(usable.length);

    // ── Pick account (round-robin) ──
    const account = pickAccount(usable);

    // ── Get next pending link ──
    const [link] = await db
      .select()
      .from(groupLinksTable)
      .where(eq(groupLinksTable.status, "pending"))
      .orderBy(groupLinksTable.createdAt)
      .limit(1);

    if (!link) {
      // P2-5: Emit links_exhausted once when queue goes empty
      const [prevLink] = await db
        .select()
        .from(groupLinksTable)
        .where(eq(groupLinksTable.status, "joined"))
        .limit(1);
      if (prevLink) {
        eventBus.publish({
          type: "links_exhausted",
          message: "📭 لا توجد روابط معلقة — انتهت قائمة الانتظار",
          timestamp: new Date().toISOString(),
        });
      }
      scheduleNext(2 * 60_000);
      return;
    }

    // Update current account in bot state
    await db
      .update(botStateTable)
      .set({ currentAccountId: account.id })
      .where(eq(botStateTable.id, state.id));

    // ── Attempt the join ──
    await attemptJoin(account, link);

    // Schedule next action with safe interval
    scheduleNext(intervalMs);
  } catch (err) {
    logger.error({ err }, "Bot engine tick error");
    if (engineRunning) scheduleNext(30_000);
  }
}

// ─── Account Rotation ───────────────────────────────────────────────────────────

function pickAccount(usable: Account[]): Account {
  accountIndex = accountIndex % usable.length;
  const account = usable[accountIndex];
  accountIndex = (accountIndex + 1) % usable.length;
  return account;
}

// ─── Join Attempt ───────────────────────────────────────────────────────────────

async function attemptJoin(
  account: Account,
  link: typeof groupLinksTable.$inferSelect
): Promise<void> {
  // Guard: account must have a session
  if (!account.sessionString) {
    await db
      .update(accountsTable)
      .set({ status: "needs_auth" })
      .where(eq(accountsTable.id, account.id));
    await logActivity(
      "join_failed",
      `⚠️ الحساب ${account.phone} لا يملك جلسة نشطة — يرجى تسجيل الدخول`,
      account.phone,
      link.url,
      "NO_SESSION"
    );
    return;
  }

  // P2-1: Build device profile for this account (stored in DB or fallback)
  const deviceProfile = {
    deviceModel: account.deviceModel ?? undefined,
    systemVersion: account.systemVersion ?? undefined,
    appVersion: account.appVersion ?? undefined,
    systemLangCode: account.systemLangCode ?? "ar",
    langPack: "tdesktop",
  };
  // If no device model stored yet, generate one deterministically
  const finalDevice = account.deviceModel
    ? deviceProfile
    : getDeviceProfileForPhone(account.phone);

  // Get or create a client for this account
  let client;
  try {
    client = await getClient(account.phone, account.sessionString, finalDevice);
  } catch (err) {
    logger.error({ err, phone: account.phone }, "Failed to get Telegram client");
    await logActivity(
      "join_failed",
      `❌ فشل الاتصال للحساب ${account.phone}`,
      account.phone,
      link.url,
      "CLIENT_ERROR"
    );
    return;
  }

  try {
    // Join the group/channel by URL
    const joined = await client.joinChat(link.url);

    const groupTitle: string | null = (joined as any)?.title ?? null;
    const chatId = (joined as any)?.id ?? null;
    const rawType: string = String((joined as any)?.chatType ?? (joined as any)?.type ?? "");
    const groupType = categorizeChatType(rawType);

    // P2-2: Post-join observation delay (3–10s) + read recent messages for AI classifier
    let sampleMessages: string[] = [];
    if (chatId) {
      sampleMessages = await observeGroupAfterJoin(client, chatId, link.url);
    }

    // P3-1 + keyword: Check relevance with AI when available
    const relevant = await isRelevantGroupAsync(groupTitle, null, sampleMessages);

    // Update link record
    await db
      .update(groupLinksTable)
      .set({
        status: "joined",
        groupTitle,
        groupType,
        usedByAccountId: account.id,
        processedAt: new Date(),
        failReason: relevant ? null : "not_in_scope",
      })
      .where(eq(groupLinksTable.id, link.id));

    // Update account counters
    await db
      .update(accountsTable)
      .set({
        joinedCount: account.joinedCount + 1,
        joinedToday: account.joinedToday + 1,
        channelsCount: account.channelsCount + 1,
        lastJoinAt: new Date(),
      })
      .where(eq(accountsTable.id, account.id));

    // P2-5: Emit join_success event
    eventBus.publish({
      type: "join_success",
      message: `✅ انضمام: ${groupTitle ?? link.url} [${account.phone}]`,
      accountPhone: account.phone,
      linkUrl: link.url,
      timestamp: new Date().toISOString(),
    });

    await logActivity(
      "join_success",
      `✅ انضمام: ${groupTitle ?? link.url} [${account.phone}]`,
      account.phone,
      link.url
    );
  } catch (err) {
    await handleJoinError(account, link, err);
  }
}

// ─── Error Handling ──────────────────────────────────────────────────────────────

async function handleJoinError(
  account: Account,
  link: typeof groupLinksTable.$inferSelect,
  err: unknown
): Promise<void> {
  const info = classifyTelegramError(err);
  logger.warn({ phone: account.phone, url: link.url, code: info.code }, "Join error classified");

  switch (info.action) {
    case "flood_wait": {
      const waitSecs = info.waitSeconds ?? 300;
      const waitUntil = new Date(Date.now() + floodWaitMs(waitSecs));
      await db
        .update(accountsTable)
        .set({ status: "flood_wait", floodWaitUntil: waitUntil })
        .where(eq(accountsTable.id, account.id));
      const msg = `⏳ FLOOD_WAIT ${waitSecs}s — الحساب ${account.phone}`;
      await logActivity("flood_wait", msg, account.phone, link.url, info.code, waitSecs);
      // P2-5: Alert for long flood waits (>1 hour)
      if (waitSecs > 3600) {
        eventBus.publish({
          type: "flood_wait_long",
          message: msg,
          accountPhone: account.phone,
          waitSeconds: waitSecs,
          timestamp: new Date().toISOString(),
        });
      }
      break;
    }

    case "peer_flood": {
      const waitUntil = new Date(Date.now() + 24 * 3_600_000);
      await db
        .update(accountsTable)
        .set({ status: "flood_wait", floodWaitUntil: waitUntil })
        .where(eq(accountsTable.id, account.id));
      const msg = `🚫 PEER_FLOOD — الحساب ${account.phone} محظور 24 ساعة`;
      await logActivity("flood_wait", msg, account.phone, link.url, info.code, 86400);
      // P2-5: Always alert for peer_flood (very serious)
      eventBus.publish({
        type: "flood_wait_long",
        message: msg,
        accountPhone: account.phone,
        waitSeconds: 86400,
        timestamp: new Date().toISOString(),
      });
      break;
    }

    case "channels_limit": {
      await db
        .update(accountsTable)
        .set({ status: "channels_limit" })
        .where(eq(accountsTable.id, account.id));
      await removeClient(account.phone);
      const msg = `⛔ CHANNELS_TOO_MUCH — الحساب ${account.phone} وصل لحد القنوات`;
      await logActivity("join_failed", msg, account.phone, link.url, info.code);
      // P2-5: Critical event — channels limit reached
      eventBus.publish({
        type: "channels_limit",
        message: msg,
        accountPhone: account.phone,
        timestamp: new Date().toISOString(),
      });
      break;
    }

    case "already_joined": {
      await db
        .update(groupLinksTable)
        .set({ status: "joined", usedByAccountId: account.id, processedAt: new Date() })
        .where(eq(groupLinksTable.id, link.id));
      await db
        .update(accountsTable)
        .set({
          joinedCount: account.joinedCount + 1,
          joinedToday: account.joinedToday + 1,
        })
        .where(eq(accountsTable.id, account.id));
      await logActivity("join_success", `✅ مشترك مسبقاً: ${link.url}`, account.phone, link.url, info.code);
      break;
    }

    case "auth_revoked": {
      await db
        .update(accountsTable)
        .set({ status: "needs_auth", sessionString: null })
        .where(eq(accountsTable.id, account.id));
      await removeClient(account.phone);
      const msg = `🔑 ${info.code} — الحساب ${account.phone} يحتاج إعادة تسجيل الدخول`;
      await logActivity("join_failed", msg, account.phone, link.url, info.code);
      // P2-4 + P2-5: Critical — notify user to re-authenticate
      eventBus.publish({
        type: "account_needs_auth",
        message: msg,
        accountPhone: account.phone,
        timestamp: new Date().toISOString(),
      });
      break;
    }

    case "account_banned": {
      await db
        .update(accountsTable)
        .set({ status: "banned", sessionString: null })
        .where(eq(accountsTable.id, account.id));
      await removeClient(account.phone);
      const msg = `🔴 الحساب ${account.phone} محظور من تيليجرام`;
      await logActivity("join_failed", msg, account.phone, link.url, info.code);
      // P2-5: Critical — account banned
      eventBus.publish({
        type: "account_banned",
        message: msg,
        accountPhone: account.phone,
        timestamp: new Date().toISOString(),
      });
      break;
    }

    case "link_failed": {
      await db
        .update(groupLinksTable)
        .set({ status: "failed", failReason: info.code, processedAt: new Date() })
        .where(eq(groupLinksTable.id, link.id));
      await db
        .update(accountsTable)
        .set({ failedCount: account.failedCount + 1 })
        .where(eq(accountsTable.id, account.id));
      await logActivity("join_failed", `❌ ${info.code}: ${link.url}`, account.phone, link.url, info.code);
      break;
    }

    default: {
      await db
        .update(groupLinksTable)
        .set({ status: "failed", failReason: info.code, processedAt: new Date() })
        .where(eq(groupLinksTable.id, link.id));
      await db
        .update(accountsTable)
        .set({ failedCount: account.failedCount + 1 })
        .where(eq(accountsTable.id, account.id));
      await logActivity("join_failed", `❓ خطأ غير متوقع: ${info.code} — ${link.url}`, account.phone, link.url, info.code);
    }
  }
}

// ─── Internal helpers ────────────────────────────────────────────────────────────

async function logActivity(
  type: string,
  message: string,
  accountPhone?: string,
  linkUrl?: string,
  errorCode?: string,
  waitSeconds?: number
): Promise<void> {
  try {
    await db.insert(activityLogTable).values({
      type,
      message,
      accountPhone: accountPhone ?? null,
      linkUrl: linkUrl ?? null,
      errorCode: errorCode ?? null,
      waitSeconds: waitSeconds ?? null,
    });
  } catch (e) {
    logger.error({ err: e }, "Failed to insert activity log");
  }
}
