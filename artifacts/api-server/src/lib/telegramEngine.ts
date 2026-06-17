/**
 * BOT ENGINE — CORE SCHEDULER (MongoDB version)
 *
 * Uses MongoDB exclusively. No PostgreSQL/Drizzle.
 * Key additions vs old version:
 *   - Checks JOINED collection before every join attempt (dedup across restarts)
 *   - On success: inserts into JOINED collection
 *   - Channels: inserts into Channels collection
 *   - parseJoinTarget: extracts username/hash from full t.me URLs
 *   - pending_review: uncertain groups go to review queue
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

// ─── URL Parser ───────────────────────────────────────────────────────────────

/**
 * Extract the correct join target from a full t.me URL.
 *
 * Examples:
 *   https://t.me/usstudents        → "usstudents"  (public username)
 *   https://t.me/+ABC123xyz        → "https://t.me/+ABC123xyz"  (private invite)
 *   https://t.me/joinchat/ABC123   → "https://t.me/joinchat/ABC123"  (old invite)
 *   t.me/usstudents                → "usstudents"
 */
export function parseJoinTarget(url: string): string {
  try {
    let normalized = url.trim();
    // Normalize t.me/ without protocol
    if (/^t\.me\//i.test(normalized)) normalized = "https://" + normalized;
    if (!/^https?:\/\//i.test(normalized)) return url;

    const u = new URL(normalized);
    const parts = u.pathname.split("/").filter(Boolean);
    if (!parts.length) return url;

    const first = parts[0]!;

    // Private invite (new format): /+HASH
    if (first.startsWith("+")) {
      return `https://t.me/${first}`;
    }

    // Private invite (old format): /joinchat/HASH
    if (first.toLowerCase() === "joinchat" && parts[1]) {
      return `https://t.me/joinchat/${parts[1]}`;
    }

    // Public group/channel username — return just the username
    return first;
  } catch {
    return url;
  }
}

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
    const activeHoursCount = Number(settingsKv["active_hours_count"] ?? 18);
    const sleepHours = 24 - activeHoursCount;

    // Derive active start from blackout_start_hour (user sets stop time, start is auto)
    // Fallback to legacy active_start_hour if blackout_start_hour not set yet
    let activeStartHour: number;
    if (settingsKv["blackout_start_hour"] !== undefined) {
      const blackoutStart = Number(settingsKv["blackout_start_hour"]);
      activeStartHour = ((blackoutStart + sleepHours) % 24 + 24) % 24;
    } else {
      activeStartHour = Number(settingsKv["active_start_hour"] ?? 8);
    }

    const { setAiFilterEnabled } = await import("./aiFilter.js");
    const aiEnabled = settingsKv["ai_filter_enabled"] === "true" ||
      (settingsKv["ai_filter_enabled"] === undefined && !!process.env["GEMINI_API_KEY"]);
    setAiFilterEnabled(aiEnabled);

    if (isBlackoutHourConfigurable(activeStartHour, activeHoursCount)) {
      // Check force-active override (user clicked "تشغيل فوراً")
      const forceUntil = state.forceActiveUntil ? new Date(state.forceActiveUntil) : null;
      if (forceUntil && forceUntil > new Date()) {
        // Override active — skip blackout this cycle
        logger.info({ forceUntil }, "Force-active override — skipping blackout");
      } else {
        const waitMs = msUntilActiveStartConfigurable(activeStartHour);
        const blackoutStart = (activeStartHour + activeHoursCount) % 24;
        logger.info({ waitMinutes: Math.ceil(waitMs / 60_000), activeStartHour, blackoutStart }, "Blackout window — pausing");
        await logActivity("bot_stopped", `⏸ وقت الراحة — ينتهي الساعة ${activeStartHour}:00`);
        scheduleNext(waitMs);
        return;
      }
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

    // attemptJoin returns true if a real relevant join happened,
    // false if the link was skipped / not-in-scope / already-joined.
    // For skips, use a short interval so the engine immediately tries the next link
    // instead of wasting the full 17-minute window on a non-productive action.
    const wasRealJoin = await attemptJoin(account, link);
    scheduleNext(wasRealJoin ? intervalMs : 8_000);
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

async function attemptJoin(account: AccountDoc, link: TargetLinkDoc): Promise<boolean> {
  const accountsCol = await collections.accounts();
  const targetLinksCol = await collections.targetLinks();

  if (!account.sessionString) {
    await accountsCol.updateOne({ _id: account._id }, { $set: { status: "needs_auth", updatedAt: new Date() } });
    await logActivity("join_failed", `⚠️ الحساب ${account.phone} لا يملك جلسة نشطة — يرجى تسجيل الدخول`, account.phone, link.url, "NO_SESSION");
    await logJoinJob(account.phone, link.url, "failed", "NO_SESSION", "لا توجد جلسة نشطة");
    return false;
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
    return false; // not a new join — skip the full interval
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
    return false;
  }

  try {
    // ── CRITICAL: Parse the join target (extract username from full URL) ──
    const joinTarget = parseJoinTarget(link.url);
    logger.debug({ url: link.url, joinTarget, phone: account.phone }, "Joining with parsed target");

    const joined = await client.joinChat(joinTarget);

    const groupTitle: string | null = (joined as any)?.title ?? null;
    const chatId = (joined as any)?.id ?? null;
    const rawType: string = String((joined as any)?.chatType ?? (joined as any)?.type ?? "");
    const groupType = categorizeChatType(rawType);

    // ── Channel detection: save to Channels collection (don't leave — channels are useful) ──
    if (groupType === "channel") {
      const channelsCol = await collections.channels();
      try {
        await channelsCol.insertOne({ _id: new ObjectId(), url: link.url, title: groupTitle, detectedAt: new Date() });
      } catch {}

      await targetLinksCol.updateOne(
        { _id: link._id },
        { $set: { status: "joined", groupTitle, groupType, usedByAccountPhone: account.phone, processedAt: new Date() } }
      );

      // Channels: only increment channelsCount — NOT joinedCount or joinedToday.
      // Subscribing to a channel is fundamentally different from joining a medical group.
      // Daily join quota (joinedToday) applies only to actual group joins.
      await accountsCol.updateOne(
        { _id: account._id },
        { $inc: { channelsCount: 1 }, $set: { lastJoinAt: new Date(), updatedAt: new Date() } }
      );

      const msg = `📡 قناة — تم الاشتراك وحفظها: ${groupTitle ?? link.url}`;
      await logActivity("join_success", msg, account.phone, link.url);
      await logJoinJob(account.phone, link.url, "success", "CHANNEL_TYPE", "قناة — تم الحفظ في مجموعة القنوات");
      eventBus.publish({ type: "channel_detected", message: msg, accountPhone: account.phone, linkUrl: link.url, timestamp: new Date().toISOString() });
      return true; // real action — respect the full interval
    }

    // ── Post-join observation: simulate reading messages (human-like behaviour) ──
    let sampleMessages: string[] = [];
    if (chatId) sampleMessages = await observeGroupAfterJoin(client, chatId, link.url);

    // ── AI / keyword relevance check (3-state: true / false / null=uncertain) ──
    const relevant = await isRelevantGroupAsync(groupTitle, null, sampleMessages);

    if (relevant === null) {
      // ── Uncertain: needs user review ──
      await targetLinksCol.updateOne(
        { _id: link._id },
        { $set: { status: "pending_review", groupTitle, groupType, usedByAccountPhone: account.phone, processedAt: new Date() } }
      );
      const msg = `🔍 غير محدد — ينتظر المراجعة: ${groupTitle ?? link.url} [${account.phone}]`;
      await logActivity("pending_review", msg, account.phone, link.url);
      await logJoinJob(account.phone, link.url, "pending_review", "UNCERTAIN", "يحتاج مراجعة يدوية");
      eventBus.publish({ type: "pending_review", message: msg, accountPhone: account.phone, linkUrl: link.url, timestamp: new Date().toISOString() });
      return false; // uncertain — try next link quickly
    }

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

    const msg = relevant
      ? `✅ انضمام: ${groupTitle ?? link.url} [${account.phone}]`
      : `ℹ️ انضمام (خارج النطاق): ${groupTitle ?? link.url} [${account.phone}]`;
    eventBus.publish({ type: "join_success", message: msg, accountPhone: account.phone, linkUrl: link.url, timestamp: new Date().toISOString() });
    await logActivity("join_success", msg, account.phone, link.url);
    await logJoinJob(account.phone, link.url, "success");

    // Return true only for a confirmed relevant join — drives the interval decision in tick()
    return relevant === true;
  } catch (err) {
    await handleJoinError(account, link, err);
    return false;
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
      // NOTE: Do NOT call removeClient here — keep the client in the pool so the
      // leave engine can reuse the SAME connection. Removing + reconnecting causes
      // AUTH_KEY_DUPLICATED because Telegram still considers the old session active.
      // The idle-cleanup job will remove the client after 30 minutes of inactivity.
      const msg = `⛔ CHANNELS_TOO_MUCH — الحساب ${account.phone} وصل لحد القنوات`;
      await logActivity("join_failed", msg, account.phone, link.url, info.code);
      await logJoinJob(account.phone, link.url, "failed", info.code, "وصل لحد القنوات (500)");
      eventBus.publish({ type: "channels_limit", message: msg, accountPhone: account.phone, timestamp: new Date().toISOString() });
      break;
    }

    case "already_joined": {
      const joinedCol = await collections.joined();
      try {
        await joinedCol.insertOne({ _id: new ObjectId(), url: link.url, accountPhone: account.phone, groupTitle: null, groupType: null, joinedAt: new Date() });
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

    case "invite_request": {
      const inviteCol = await collections.inviteRequests();
      try {
        await inviteCol.insertOne({
          _id: new ObjectId(),
          url: link.url,
          accountPhone: account.phone,
          status: "pending",
          groupTitle: null,
          sentAt: new Date(),
          approvedAt: null,
          updatedAt: new Date(),
        });
      } catch (_) {}
      await targetLinksCol.updateOne(
        { _id: link._id },
        { $set: { status: "invite_request", usedByAccountPhone: account.phone, processedAt: new Date() } }
      );
      const invMsg = `📩 طلب انضمام مُرسَل: ${link.url} [${account.phone}]`;
      await logActivity("invite_request", invMsg, account.phone, link.url, info.code);
      await logJoinJob(account.phone, link.url, "invite_request", info.code, "في انتظار موافقة المشرف");
      eventBus.publish({ type: "invite_request", message: invMsg, accountPhone: account.phone, linkUrl: link.url, timestamp: new Date().toISOString() });
      break;
    }

    case "auth_key_duplicated": {
      // AUTH_KEY_DUPLICATED means two connections opened simultaneously for the same account.
      // The session in MongoDB is STILL VALID — do NOT wipe it.
      // Fix: remove the stale client from the pool so the next tick reconnects cleanly.
      await removeClient(account.phone);
      const dupMsg = `🔄 AUTH_KEY_DUPLICATED — إعادة اتصال الحساب ${account.phone} (الجلسة محفوظة — لا حاجة لإعادة تسجيل الدخول)`;
      await logActivity("join_failed", dupMsg, account.phone, link.url, info.code);
      await logJoinJob(account.phone, link.url, "failed", info.code, "تكرار مفتاح الاتصال — إعادة الاتصال تلقائياً");
      logger.warn({ phone: account.phone, code: info.code }, "AUTH_KEY_DUPLICATED — client removed, session preserved in DB, will reconnect on next tick");
      break;
    }

    case "auth_revoked": {
      // Truly revoked session (AUTH_KEY_UNREGISTERED, SESSION_EXPIRED, SESSION_REVOKED, etc.)
      // Only in this case do we mark the account as needs_auth.
      // We deliberately keep sessionString in DB in case the user wants to inspect it —
      // but we set status to needs_auth so the engine skips this account.
      await accountsCol.updateOne({ _id: account._id }, { $set: { status: "needs_auth", updatedAt: new Date() } });
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
