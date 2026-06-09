/**
 * BOT ENGINE — CORE SCHEDULER (MongoDB version)
 *
 * Uses MongoDB exclusively. No PostgreSQL/Drizzle.
 * Key additions vs old version:
 *   - Checks JOINED collection before every join attempt (dedup across restarts)
 *   - On success: inserts into JOINED collection
 *   - Channels: inserts into Channels collection
 */

import { ObjectId } from "mongodb";
import {
  collections,
  getBotState,
  setBotState,
  getSettings,
} from "@workspace/db";
import type { AccountDoc, TargetLinkDoc } from "@workspace/db";
import { logger } from "./logger.js";
import {
  computeActionIntervalMs,
  isBlackoutHourConfigurable,
  msUntilActiveStartConfigurable,
  floodWaitMs,
  shouldResetDailyCounter,
  DAILY_LIMIT,
} from "./timing.js";
import { classifyTelegramError } from "./telegramErrors.js";
import { isRelevantGroupAsync, categorizeChatType, observeGroupAfterJoin } from "./groupFilter.js";
import { getClient, removeClient } from "./clientPool.js";
import { getDeviceProfileForPhone } from "./deviceProfiles.js";
import { eventBus } from "./eventBus.js";

const MAX_RETRY_COUNT = 3;
const RETRY_DELAY_MS = 60 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;
let engineRunning = false;
let accountIndex = 0;

// ─── Public API ──────────────────────────────────────────────────────────────

export async function engineInit(): Promise<void> {
  const state = await getBotState();
  if (state.running) {
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
  if (timer) { clearTimeout(timer); timer = null; }
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

// ─── Scheduler ───────────────────────────────────────────────────────────────

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
    const state = await getBotState();
    if (!state.running) { engineRunning = false; return; }

    // ── Configurable sleep schedule ──
    const settingsKv = await getSettings();
    const activeStartHour = Number(settingsKv["active_start_hour"] ?? 8);

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

    const now = new Date();
    const accountsCol = await collections.accounts();

    // ── Auto-reset expired flood_wait accounts ──
    await accountsCol.updateMany(
      { status: "flood_wait", floodWaitUntil: { $lte: now } },
      { $set: { status: "active", floodWaitUntil: null, updatedAt: now } }
    );

    // ── Get active accounts (sort by _id for stable round-robin) ──
    const allActive = await accountsCol.find({ status: "active" }).sort({ _id: 1 }).toArray();

    for (const acc of allActive) {
      if (shouldResetDailyCounter(acc.dailyResetAt)) {
        await accountsCol.updateOne(
          { _id: acc._id },
          { $set: { joinedToday: 0, dailyResetAt: now, updatedAt: now } }
        );
        acc.joinedToday = 0;
        acc.dailyResetAt = now;
      }
    }

    const usable = allActive.filter((acc) => (acc.joinedToday ?? 0) < (acc.dailyLimit ?? DAILY_LIMIT));

    if (usable.length === 0) {
      scheduleNext(5 * 60_000);
      return;
    }

    const intervalMs = computeActionIntervalMs(usable.length);
    const account = pickAccount(usable);

    // ── Get next link ──
    const targetLinksCol = await collections.targetLinks();
    let link = await targetLinksCol.findOne({ status: "pending" }, { sort: { createdAt: 1 } });

    if (!link) {
      link = await targetLinksCol.findOne(
        {
          status: "failed",
          retryCount: { $lt: MAX_RETRY_COUNT },
          retryAfter: { $lte: now, $ne: null },
        },
        { sort: { retryAfter: 1 } }
      );
    }

    if (!link) {
      const hasJoined = await targetLinksCol.countDocuments({ status: "joined" });
      if (hasJoined > 0) {
        eventBus.publish({
          type: "links_exhausted",
          message: "📭 لا توجد روابط معلقة — انتهت قائمة الانتظار",
          timestamp: new Date().toISOString(),
        });
      }
      scheduleNext(2 * 60_000);
      return;
    }

    // Reset failed links back to pending before attempting
    if (link.status === "failed") {
      await targetLinksCol.updateOne(
        { _id: link._id },
        { $set: { status: "pending", retryAfter: null } }
      );
      link = { ...link, status: "pending", retryAfter: null };
    }

    await setBotState({ currentAccountPhone: account.phone });

    await attemptJoin(account, link);
    scheduleNext(intervalMs);
  } catch (err) {
    logger.error({ err }, "Bot engine tick error");
    if (engineRunning) scheduleNext(30_000);
  }
}

// ─── Account Rotation ────────────────────────────────────────────────────────

function pickAccount(usable: AccountDoc[]): AccountDoc {
  accountIndex = accountIndex % usable.length;
  const account = usable[accountIndex]!;
  accountIndex = (accountIndex + 1) % usable.length;
  return account;
}

// ─── Join Attempt ────────────────────────────────────────────────────────────

async function attemptJoin(account: AccountDoc, link: TargetLinkDoc): Promise<void> {
  const accountsCol = await collections.accounts();
  const targetLinksCol = await collections.targetLinks();

  if (!account.sessionString) {
    await accountsCol.updateOne({ _id: account._id }, { $set: { status: "needs_auth", updatedAt: new Date() } });
    await logActivity("join_failed", `⚠️ الحساب ${account.phone} لا يملك جلسة نشطة — يرجى تسجيل الدخول`, account.phone, link.url, "NO_SESSION");
    await logJoinJob(account.phone, link.url, "failed", "NO_SESSION", "لا توجد جلسة نشطة");
    return;
  }

  // ── Check JOINED collection — skip if already joined ──
  const joinedCol = await collections.joined();
  const alreadyJoined = await joinedCol.findOne({ url: link.url });
  if (alreadyJoined) {
    const msg = `✅ تم الانضمام مسبقاً لهذا الرابط من الحساب ${alreadyJoined.accountPhone}: ${link.url}`;
    logger.info({ url: link.url, accountPhone: alreadyJoined.accountPhone }, "Link already in JOINED collection — skipping");
    await targetLinksCol.updateOne(
      { _id: link._id },
      { $set: { status: "joined", usedByAccountPhone: alreadyJoined.accountPhone, processedAt: new Date() } }
    );
    await logActivity("join_success", msg, account.phone, link.url, "ALREADY_IN_JOINED");
    await logJoinJob(account.phone, link.url, "success", "ALREADY_IN_JOINED", `تم الانضمام مسبقاً من ${alreadyJoined.accountPhone}`);
    return;
  }

  const deviceProfile = {
    deviceModel: account.deviceModel ?? undefined,
    systemVersion: account.systemVersion ?? undefined,
    appVersion: account.appVersion ?? undefined,
    systemLangCode: account.systemLangCode ?? "ar",
    langPack: "tdesktop",
  };
  const finalDevice = account.deviceModel ? deviceProfile : getDeviceProfileForPhone(account.phone);

  let client;
  try {
    client = await getClient(account.phone, account.sessionString, finalDevice);
  } catch (err) {
    logger.error({ err, phone: account.phone }, "Failed to get Telegram client");
    await logActivity("join_failed", `❌ فشل الاتصال للحساب ${account.phone}`, account.phone, link.url, "CLIENT_ERROR");
    await logJoinJob(account.phone, link.url, "failed", "CLIENT_ERROR", "فشل إنشاء الاتصال");
    return;
  }

  try {
    const joined = await client.joinChat(link.url);

    const groupTitle: string | null = (joined as any)?.title ?? null;
    const chatId = (joined as any)?.id ?? null;
    const rawType: string = String((joined as any)?.chatType ?? (joined as any)?.type ?? "");
    const groupType = categorizeChatType(rawType);

    // ── Channel detection: leave immediately + save to Channels ──
    if (groupType === "channel") {
      try { await client.leaveChat(chatId ?? link.url); } catch {}

      const channelsCol = await collections.channels();
      try {
        await channelsCol.insertOne({ _id: new ObjectId(), url: link.url, title: groupTitle, detectedAt: new Date() });
      } catch {}

      await targetLinksCol.updateOne(
        { _id: link._id },
        { $set: { status: "skipped", failReason: "channel_type", groupTitle, groupType, processedAt: new Date() } }
      );

      const msg = `📡 قناة — تم حفظها: ${groupTitle ?? link.url}`;
      await logActivity("skipped", msg, account.phone, link.url);
      await logJoinJob(account.phone, link.url, "skipped", "CHANNEL_TYPE", "قناة — تم الحفظ في مجموعة القنوات");
      eventBus.publish({ type: "channel_detected", message: msg, accountPhone: account.phone, linkUrl: link.url, timestamp: new Date().toISOString() });
      return;
    }

    // ── Post-join observation + AI relevance check ──
    let sampleMessages: string[] = [];
    if (chatId) sampleMessages = await observeGroupAfterJoin(client, chatId, link.url);
    const relevant = await isRelevantGroupAsync(groupTitle, null, sampleMessages);

    // ── Update TARGET_LINKS ──
    await targetLinksCol.updateOne(
      { _id: link._id },
      {
        $set: {
          status: "joined",
          groupTitle,
          groupType,
          usedByAccountPhone: account.phone,
          processedAt: new Date(),
          failReason: relevant ? null : "not_in_scope",
        },
      }
    );

    // ── Insert into JOINED (permanent dedup record) ──
    try {
      await joinedCol.insertOne({
        _id: new ObjectId(),
        url: link.url,
        accountPhone: account.phone,
        groupTitle,
        groupType,
        joinedAt: new Date(),
      });
    } catch {}

    // ── Update account counters ──
    await accountsCol.updateOne(
      { _id: account._id },
      {
        $inc: { joinedCount: 1, joinedToday: 1, channelsCount: 1 },
        $set: { lastJoinAt: new Date(), updatedAt: new Date() },
      }
    );

    const msg = `✅ انضمام: ${groupTitle ?? link.url} [${account.phone}]`;
    eventBus.publish({ type: "join_success", message: msg, accountPhone: account.phone, linkUrl: link.url, timestamp: new Date().toISOString() });
    await logActivity("join_success", msg, account.phone, link.url);
    await logJoinJob(account.phone, link.url, "success");
  } catch (err) {
    await handleJoinError(account, link, err);
  }
}

// ─── Error Handling ───────────────────────────────────────────────────────────

async function handleJoinError(account: AccountDoc, link: TargetLinkDoc, err: unknown): Promise<void> {
  const info = classifyTelegramError(err);
  logger.warn({ phone: account.phone, url: link.url, code: info.code }, "Join error classified");

  const accountsCol = await collections.accounts();
  const targetLinksCol = await collections.targetLinks();

  switch (info.action) {
    case "flood_wait": {
      const waitSecs = info.waitSeconds ?? 300;
      const waitUntil = new Date(Date.now() + floodWaitMs(waitSecs));
      await accountsCol.updateOne({ _id: account._id }, { $set: { status: "flood_wait", floodWaitUntil: waitUntil, updatedAt: new Date() } });
      const msg = `⏳ FLOOD_WAIT ${waitSecs}s — الحساب ${account.phone}`;
      await logActivity("flood_wait", msg, account.phone, link.url, info.code, waitSecs);
      await logJoinJob(account.phone, link.url, "flood_wait", info.code, `انتظر ${waitSecs} ثانية`);
      if (waitSecs > 3600) eventBus.publish({ type: "flood_wait_long", message: msg, accountPhone: account.phone, waitSeconds: waitSecs, timestamp: new Date().toISOString() });
      break;
    }

    case "peer_flood": {
      const waitUntil = new Date(Date.now() + 24 * 3_600_000);
      await accountsCol.updateOne({ _id: account._id }, { $set: { status: "flood_wait", floodWaitUntil: waitUntil, updatedAt: new Date() } });
      const msg = `🚫 PEER_FLOOD — الحساب ${account.phone} محظور 24 ساعة`;
      await logActivity("flood_wait", msg, account.phone, link.url, info.code, 86400);
      await logJoinJob(account.phone, link.url, "flood_wait", info.code, "PEER_FLOOD — 24 ساعة");
      eventBus.publish({ type: "flood_wait_long", message: msg, accountPhone: account.phone, waitSeconds: 86400, timestamp: new Date().toISOString() });
      break;
    }

    case "channels_limit": {
      await accountsCol.updateOne({ _id: account._id }, { $set: { status: "channels_limit", updatedAt: new Date() } });
      await removeClient(account.phone);
      const msg = `⛔ CHANNELS_TOO_MUCH — الحساب ${account.phone} وصل لحد القنوات`;
      await logActivity("join_failed", msg, account.phone, link.url, info.code);
      await logJoinJob(account.phone, link.url, "failed", info.code, "وصل لحد القنوات (500)");
      eventBus.publish({ type: "channels_limit", message: msg, accountPhone: account.phone, timestamp: new Date().toISOString() });
      break;
    }

    case "already_joined": {
      // Insert into JOINED (dedup record) + mark TARGET_LINKS as joined
      const joinedCol = await collections.joined();
      try {
        await joinedCol.insertOne({
          _id: new ObjectId(),
          url: link.url,
          accountPhone: account.phone,
          groupTitle: null,
          groupType: null,
          joinedAt: new Date(),
        });
      } catch {}
      await targetLinksCol.updateOne(
        { _id: link._id },
        { $set: { status: "joined", usedByAccountPhone: account.phone, processedAt: new Date() } }
      );
      await accountsCol.updateOne({ _id: account._id }, { $inc: { joinedCount: 1 }, $set: { updatedAt: new Date() } });
      await logActivity("join_success", `✅ مشترك مسبقاً: ${link.url}`, account.phone, link.url, info.code);
      await logJoinJob(account.phone, link.url, "success", info.code, "مشترك مسبقاً");
      break;
    }

    case "auth_revoked": {
      await accountsCol.updateOne({ _id: account._id }, { $set: { status: "needs_auth", sessionString: null, updatedAt: new Date() } });
      await removeClient(account.phone);
      const msg = `🔑 ${info.code} — الحساب ${account.phone} يحتاج إعادة تسجيل الدخول`;
      await logActivity("join_failed", msg, account.phone, link.url, info.code);
      await logJoinJob(account.phone, link.url, "failed", info.code, "انتهت الجلسة — يحتاج re-auth");
      eventBus.publish({ type: "account_needs_auth", message: msg, accountPhone: account.phone, timestamp: new Date().toISOString() });
      break;
    }

    case "account_banned": {
      await accountsCol.updateOne({ _id: account._id }, { $set: { status: "banned", sessionString: null, updatedAt: new Date() } });
      await removeClient(account.phone);
      const msg = `🔴 الحساب ${account.phone} محظور من تيليجرام`;
      await logActivity("join_failed", msg, account.phone, link.url, info.code);
      await logJoinJob(account.phone, link.url, "failed", info.code, "الحساب محظور نهائياً");
      eventBus.publish({ type: "account_banned", message: msg, accountPhone: account.phone, timestamp: new Date().toISOString() });
      break;
    }

    case "link_failed": {
      await targetLinksCol.updateOne(
        { _id: link._id },
        { $set: { status: "failed", failReason: info.code, processedAt: new Date() } }
      );
      await accountsCol.updateOne({ _id: account._id }, { $inc: { failedCount: 1 }, $set: { updatedAt: new Date() } });
      await logActivity("join_failed", `❌ ${info.code}: ${link.url}`, account.phone, link.url, info.code);
      await logJoinJob(account.phone, link.url, "failed", info.code, "الرابط معطل أو خاص");
      break;
    }

    default: {
      const newRetryCount = (link.retryCount ?? 0) + 1;
      const isExhausted = newRetryCount >= MAX_RETRY_COUNT;
      const retryAfterTime = isExhausted ? null : new Date(Date.now() + RETRY_DELAY_MS);
      await targetLinksCol.updateOne(
        { _id: link._id },
        {
          $set: {
            status: "failed",
            failReason: info.code,
            retryCount: newRetryCount,
            retryAfter: retryAfterTime,
            processedAt: new Date(),
          },
        }
      );
      await accountsCol.updateOne({ _id: account._id }, { $inc: { failedCount: 1 }, $set: { updatedAt: new Date() } });
      const retryNote = isExhausted
        ? `(${newRetryCount}/${MAX_RETRY_COUNT} محاولات — فشل نهائي)`
        : `(محاولة ${newRetryCount}/${MAX_RETRY_COUNT} — إعادة المحاولة بعد ساعة)`;
      const msg = `❓ خطأ غير متوقع: ${info.code} — ${link.url} ${retryNote}`;
      await logActivity("join_failed", msg, account.phone, link.url, info.code);
      await logJoinJob(account.phone, link.url, isExhausted ? "failed" : "pending", info.code, retryNote);
    }
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function logActivity(
  type: string,
  message: string,
  accountPhone?: string,
  linkUrl?: string,
  errorCode?: string,
  waitSeconds?: number
): Promise<void> {
  try {
    const col = await collections.activityLog();
    await col.insertOne({
      _id: new ObjectId(),
      type,
      message,
      accountPhone: accountPhone ?? null,
      linkUrl: linkUrl ?? null,
      errorCode: errorCode ?? null,
      waitSeconds: waitSeconds ?? null,
      createdAt: new Date(),
    });
  } catch (e) {
    logger.error({ err: e }, "Failed to insert activity log");
  }
}

async function logJoinJob(
  accountPhone: string,
  linkUrl: string,
  status: string,
  errorCode?: string,
  errorMessage?: string
): Promise<void> {
  try {
    const col = await collections.joinHistory();
    await col.insertOne({
      _id: new ObjectId(),
      accountPhone,
      linkUrl,
      status,
      errorCode: errorCode ?? null,
      errorMessage: errorMessage ?? null,
      createdAt: new Date(),
    });
  } catch (e) {
    logger.error({ err: e }, "Failed to insert join history");
  }
}
