/**
 * TELEGRAM AUTH ROUTES
 *
 * Phone-number OTP flow with optional 2FA (cloud password).
 * Uses MongoDB accounts collection — no PostgreSQL.
 *
 *   1. POST /api/auth/send-code
 *   2. POST /api/auth/verify-code
 *   3. POST /api/auth/verify-password
 *   4. GET  /api/auth/status/:phone
 *   5. POST /api/auth/cancel
 */

import { Router, type IRouter } from "express";
import { ObjectId } from "mongodb";
import { TelegramClient, SentCode } from "@mtcute/node";
import { collections } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { createTempClient, getClient, getPooledClientOnly } from "../lib/clientPool.js";

const router: IRouter = Router();

/**
 * Extract a 5-6 digit OTP from a Telegram service message.
 * Telegram uses many different message formats across regions & languages.
 */
function extractOtpFromText(text: string): string | null {
  if (!text) return null;

  // Pattern 1: code at start of line (most common format)
  // "12345 is your login code" / "12345 - ваш код"
  let m = text.match(/^(\d{5,6})[\s\n\-–—]/m);
  if (m?.[1]) return m[1];

  // Pattern 2: code after common keywords with colon/space
  // "Your code: 12345" / "Login code: 12345" / "كود: 12345"
  m = text.match(/(?:code|كود|رمز|код)[:\s]+(\d{5,6})/i);
  if (m?.[1]) return m[1];

  // Pattern 3: code on its own line (service messages)
  m = text.match(/^\s*(\d{5,6})\s*$/m);
  if (m?.[1]) return m[1];

  // Pattern 4: fallback — any word-boundary 5-6 digit number in the message
  m = text.match(/\b(\d{5,6})\b/);
  if (m?.[1]) return m[1];

  return null;
}

interface PendingSession {
  client: TelegramClient;
  sentCode: SentCode;
  step: "code" | "password";
  phone: string;
  createdAt: Date;
}

const pendingAuth = new Map<string, PendingSession>();

setInterval(() => {
  const threshold = Date.now() - 10 * 60_000;
  for (const [phone, session] of pendingAuth.entries()) {
    if (session.createdAt.getTime() < threshold) {
      session.client.destroy().catch(() => {});
      pendingAuth.delete(phone);
      logger.info({ phone }, "Expired pending auth session cleaned up");
    }
  }
}, 60_000);

async function saveSession(phone: string, client: TelegramClient): Promise<void> {
  const sessionString = await client.exportSession();
  const col = await collections.accounts();
  const now = new Date();
  const existing = await col.findOne({ phone });
  if (existing) {
    await col.updateOne({ phone }, { $set: { sessionString, status: "active", updatedAt: now } });
  } else {
    const { getDeviceProfileForPhone } = await import("../lib/deviceProfiles.js");
    const device = getDeviceProfileForPhone(phone);
    await col.insertOne({
      _id: new ObjectId(),
      phone,
      label: null,
      status: "active",
      sessionString,
      joinedCount: 0,
      failedCount: 0,
      joinedToday: 0,
      dailyLimit: 85,
      currentDelay: 1030,
      floodWaitUntil: null,
      lastJoinAt: null,
      nextJoinAllowedAt: null,
      dailyResetAt: null,
      channelsCount: 0,
      isPremium: false,
      deviceModel: device.deviceModel,
      systemVersion: device.systemVersion,
      appVersion: device.appVersion,
      systemLangCode: device.systemLangCode,
      createdAt: now,
      updatedAt: now,
    });
  }
}

router.post("/auth/send-code", async (req, res): Promise<void> => {
  const { phone } = req.body as { phone?: string };
  if (!phone || typeof phone !== "string" || !phone.startsWith("+")) {
    res.status(400).json({ error: "رقم الهاتف غير صحيح. يجب أن يبدأ بـ +" });
    return;
  }

  const existing = pendingAuth.get(phone);
  if (existing) { await existing.client.destroy().catch(() => {}); pendingAuth.delete(phone); }

  let client: TelegramClient;
  try {
    client = await createTempClient();
  } catch (credErr: any) {
    res.status(503).json({ error: credErr?.message ?? "بيانات اعتماد Telegram API غير مضبوطة." });
    return;
  }

  try {
    await client.connect();
    const result = await client.sendCode({ phone });
    if (!(result instanceof SentCode)) {
      await saveSession(phone, client);
      await client.destroy();
      res.json({ sent: false, alreadyLoggedIn: true });
      return;
    }
    pendingAuth.set(phone, { client, sentCode: result, step: "code", phone, createdAt: new Date() });
    res.json({ sent: true, type: result.type, length: result.length, timeout: result.timeout, nextType: result.nextType });
  } catch (err: any) {
    await client.destroy().catch(() => {});
    res.status(400).json({ error: err?.errorMessage ?? err?.message ?? "UNKNOWN" });
  }
});

router.post("/auth/verify-code", async (req, res): Promise<void> => {
  const { phone, code } = req.body as { phone?: string; code?: string };
  if (!phone || !code) { res.status(400).json({ error: "phone و code مطلوبان" }); return; }
  const session = pendingAuth.get(phone);
  if (!session) { res.status(400).json({ error: "لا توجد جلسة تحقق نشطة لهذا الرقم." }); return; }

  try {
    const user = await session.client.signIn({
      phone,
      phoneCodeHash: session.sentCode.phoneCodeHash,
      phoneCode: code,
    });
    await saveSession(phone, session.client);
    pendingAuth.delete(phone);
    await session.client.destroy();
    res.json({ success: true, userId: (user as any)?.id?.toString() ?? null, firstName: (user as any)?.firstName ?? null });
  } catch (err: any) {
    const errorMsg: string = err?.errorMessage ?? err?.message ?? "";
    if (errorMsg.includes("SESSION_PASSWORD_NEEDED") || err?.constructor?.name === "SessionPasswordNeededError") {
      session.step = "password";
      res.json({ needPassword: true });
      return;
    }
    res.status(400).json({ error: err?.errorMessage ?? err?.message ?? "UNKNOWN" });
  }
});

router.post("/auth/verify-password", async (req, res): Promise<void> => {
  const { phone, password } = req.body as { phone?: string; password?: string };
  if (!phone || !password) { res.status(400).json({ error: "phone و password مطلوبان" }); return; }
  const session = pendingAuth.get(phone);
  if (!session || session.step !== "password") { res.status(400).json({ error: "لا توجد جلسة تحقق بكلمة مرور نشطة." }); return; }

  try {
    const user = await session.client.checkPassword(password);
    await saveSession(phone, session.client);
    pendingAuth.delete(phone);
    await session.client.destroy();
    res.json({ success: true, userId: (user as any)?.id?.toString() ?? null, firstName: (user as any)?.firstName ?? null });
  } catch (err: any) {
    res.status(400).json({ error: err?.errorMessage ?? err?.message ?? "UNKNOWN" });
  }
});

router.get("/auth/status/:phone", async (req, res): Promise<void> => {
  const phone = decodeURIComponent(req.params["phone"] ?? "");
  const col = await collections.accounts();
  const account = await col.findOne({ phone });
  if (!account) { res.status(404).json({ error: "Account not found" }); return; }
  const hasPending = pendingAuth.has(phone);
  res.json({
    phone,
    hasSession: !!account.sessionString,
    status: account.status,
    hasPendingAuth: hasPending,
    pendingStep: hasPending ? (pendingAuth.get(phone)?.step ?? null) : null,
  });
});

router.post("/auth/cancel", async (req, res): Promise<void> => {
  const { phone } = req.body as { phone?: string };
  if (!phone) { res.status(400).json({ error: "phone مطلوب" }); return; }
  const session = pendingAuth.get(phone);
  if (session) { await session.client.destroy().catch(() => {}); pendingAuth.delete(phone); }
  res.json({ cancelled: true });
});

/**
 * GET /auth/pending-code/:phone[?after=<unix_seconds>]
 * Reads recent messages from Telegram service number 777000 and extracts
 * any OTP code found. Works for active sessions (not just during re-auth).
 *
 * Query param:
 *   after — Unix timestamp (seconds). Only return codes with msg.date >= after.
 *           Use this to filter out old stored codes and only capture new ones.
 *
 * Returns { found: true, code: "12345", date: 1720000000 } or { found: false }.
 */
router.get("/auth/pending-code/:phone", async (req, res): Promise<void> => {
  const phone = decodeURIComponent(req.params["phone"] ?? "");
  if (!phone) { res.json({ found: false }); return; }

  // Only return codes received at or after this Unix timestamp (seconds)
  const afterTs = req.query["after"] ? parseInt(req.query["after"] as string, 10) : 0;

  try {
    // ── Priority 1: use an ALREADY POOLED client (engine-managed connection).
    //   Never create a new connection here — creating a new client while the
    //   engine already has one active for the same phone causes AUTH_KEY_DUPLICATED
    //   because Telegram detects two connections sharing the same auth key.
    let client: any = getPooledClientOnly(phone);

    // ── Priority 2: re-auth flow — a pending auth session is in progress.
    //   The auth route already has a live client for this phone; use it.
    if (!client) {
      const pending = pendingAuth.get(phone);
      if (pending?.client) {
        client = pending.client;
      }
    }

    // ── No active connection at all → return false without connecting.
    //   The caller (CodeWatchPanel / AuthDialog) should show "not connected" state.
    if (!client) {
      res.json({ found: false });
      return;
    }

    // Telegram OTP sender is 777000 in most regions, but some see it as +42777 (id: 42777)
    // Try both peers to be safe
    const SENDER_IDS = ["777000", "42777"];
    for (const senderId of SENDER_IDS) {
      try {
        const peer = await (client as any).resolvePeer(senderId);
        const result = await (client as any).call({
          _: "messages.getHistory",
          peer,
          offsetId: 0,
          offsetDate: 0,
          addOffset: 0,
          limit: 8,
          maxId: 0,
          minId: 0,
          hash: BigInt(0),
        });

        const messages: any[] = result?.messages ?? [];
        for (const msg of messages) {
          const text: string = msg?.message ?? "";
          const msgDate: number = msg?.date ?? 0;

          // Skip codes that arrived before we started watching
          if (afterTs && msgDate < afterTs) continue;

          // Telegram OTP messages come in many formats — try all patterns:
          // "12345 is your login code"
          // "Your code: 12345"
          // "Login code:\n12345"
          // "<b>12345</b>" (service messages)
          const code = extractOtpFromText(text);
          if (code) {
            res.json({ found: true, code, date: msgDate, sender: senderId });
            return;
          }
        }
      } catch (_) {
        // This sender ID doesn't exist or failed — try next
      }
    }
  } catch (_) {
    // Outer connection error — fail silently, do NOT create new connection
  }

  res.json({ found: false });
});

/**
 * GET /auth/debug-messages/:phone
 * Returns the last 8 raw messages from BOTH 777000 and +42777,
 * so the user can see exactly which sender delivers OTP codes on their account.
 * Includes full message text, date, extracted code (if any), and sender ID.
 */
router.get("/auth/debug-messages/:phone", async (req, res): Promise<void> => {
  const phone = decodeURIComponent(req.params["phone"] ?? "");
  if (!phone) { res.json({ senders: [] }); return; }

  let client: any = getPooledClientOnly(phone);
  if (!client) {
    const pending = pendingAuth.get(phone);
    if (pending?.client) client = pending.client;
  }
  if (!client) { res.json({ senders: [], error: "no_connection" }); return; }

  const SENDER_IDS = ["777000", "42777"];
  const results: Array<{
    sender: string;
    status: "ok" | "error";
    error?: string;
    messages: Array<{ text: string; date: number; extractedCode: string | null }>;
  }> = [];

  for (const senderId of SENDER_IDS) {
    try {
      const peer = await (client as any).resolvePeer(senderId);
      const result = await (client as any).call({
        _: "messages.getHistory",
        peer,
        offsetId: 0,
        offsetDate: 0,
        addOffset: 0,
        limit: 8,
        maxId: 0,
        minId: 0,
        hash: BigInt(0),
      });
      const messages: any[] = result?.messages ?? [];
      results.push({
        sender: senderId,
        status: "ok",
        messages: messages.map((m: any) => ({
          text: m?.message ?? "",
          date: m?.date ?? 0,
          extractedCode: extractOtpFromText(m?.message ?? ""),
        })),
      });
    } catch (err: any) {
      results.push({
        sender: senderId,
        status: "error",
        error: err?.message ?? String(err),
        messages: [],
      });
    }
  }

  res.json({ senders: results });
});

export default router;
