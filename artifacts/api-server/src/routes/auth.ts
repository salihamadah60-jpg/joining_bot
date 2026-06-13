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
import { createTempClient, getClient } from "../lib/clientPool.js";

const router: IRouter = Router();

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
 * GET /auth/pending-code/:phone
 * Tries to auto-capture the OTP code from Telegram service messages (777000).
 * Works when the account has an existing session string in the DB.
 * Returns { found: true, code: "12345" } or { found: false }.
 */
router.get("/auth/pending-code/:phone", async (req, res): Promise<void> => {
  const phone = decodeURIComponent(req.params["phone"] ?? "");
  if (!phone) { res.json({ found: false }); return; }

  try {
    const col = await collections.accounts();
    const account = await col.findOne({ phone });
    if (!account?.sessionString) {
      res.json({ found: false });
      return;
    }

    const client = await getClient(phone, account.sessionString, account as any);

    const peer = await (client as any).resolvePeer("777000");
    const result = await (client as any).call({
      _: "messages.getHistory",
      peer,
      offsetId: 0,
      offsetDate: 0,
      addOffset: 0,
      limit: 3,
      maxId: 0,
      minId: 0,
      hash: BigInt(0),
    });

    const messages: any[] = result?.messages ?? [];
    for (const msg of messages) {
      const text: string = msg?.message ?? "";
      // Telegram OTP messages start with the code: "12345 is your login code"
      const match = text.match(/^(\d{5,6})[\s\n\-–]/);
      if (match && match[1]) {
        res.json({ found: true, code: match[1] });
        return;
      }
    }
  } catch (_) {
    // Session expired or not accessible — fail silently
  }

  res.json({ found: false });
});

export default router;
