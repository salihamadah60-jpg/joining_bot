/**
 * TELEGRAM AUTH ROUTES
 *
 * Phone-number OTP flow with optional 2FA (cloud password).
 * Uses MemoryStorage — NO SQLite / better-sqlite3.
 *
 *   1. POST /api/auth/send-code    { phone }
 *   2. POST /api/auth/verify-code  { phone, code }
 *   3. POST /api/auth/verify-password  { phone, password }
 *   4. GET  /api/auth/status/:phone
 */

import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, accountsTable } from "@workspace/db";
import { TelegramClient, SentCode } from "@mtcute/node";
import { logger } from "../lib/logger.js";
import { createTempClient } from "../lib/clientPool.js";

const router: IRouter = Router();

// ─── Pending auth session state ─────────────────────────────────────────────

interface PendingSession {
  client: TelegramClient;
  sentCode: SentCode;
  step: "code" | "password";
  phone: string;
  createdAt: Date;
}

const pendingAuth = new Map<string, PendingSession>();

// Clean up pending sessions older than 10 minutes
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

  const existing = await db
    .select()
    .from(accountsTable)
    .where(eq(accountsTable.phone, phone))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(accountsTable)
      .set({ sessionString, status: "active" })
      .where(eq(accountsTable.phone, phone));
  } else {
    await db.insert(accountsTable).values({
      phone,
      sessionString,
      status: "active",
      label: null,
    });
  }
}

// ─── POST /api/auth/send-code ────────────────────────────────────────────────

router.post("/auth/send-code", async (req, res): Promise<void> => {
  const { phone } = req.body as { phone?: string };

  if (!phone || typeof phone !== "string" || !phone.startsWith("+")) {
    res.status(400).json({ error: "رقم الهاتف غير صحيح. يجب أن يبدأ بـ +" });
    return;
  }

  // Destroy any existing pending session for this phone
  const existing = pendingAuth.get(phone);
  if (existing) {
    await existing.client.destroy().catch(() => {});
    pendingAuth.delete(phone);
  }

  let client: TelegramClient;
  try {
    client = await createTempClient();
  } catch (credErr: any) {
    res.status(503).json({ error: credErr?.message ?? "بيانات اعتماد Telegram API غير مضبوطة. أدخلها من صفحة الإعدادات." });
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

    pendingAuth.set(phone, {
      client,
      sentCode: result,
      step: "code",
      phone,
      createdAt: new Date(),
    });

    res.json({
      sent: true,
      type: result.type,
      length: result.length,
      timeout: result.timeout,
      nextType: result.nextType,
    });
  } catch (err: any) {
    await client.destroy().catch(() => {});
    const code = err?.errorMessage ?? err?.message ?? "UNKNOWN";
    logger.error({ phone, code }, "Failed to send auth code");
    res.status(400).json({ error: code });
  }
});

// ─── POST /api/auth/verify-code ─────────────────────────────────────────────

router.post("/auth/verify-code", async (req, res): Promise<void> => {
  const { phone, code } = req.body as { phone?: string; code?: string };

  if (!phone || !code) {
    res.status(400).json({ error: "phone و code مطلوبان" });
    return;
  }

  const session = pendingAuth.get(phone);
  if (!session) {
    res.status(400).json({ error: "لا توجد جلسة تحقق نشطة لهذا الرقم. أعد إرسال الكود." });
    return;
  }

  try {
    const user = await session.client.signIn({
      phone,
      phoneCodeHash: session.sentCode.phoneCodeHash,
      phoneCode: code,
    });

    await saveSession(phone, session.client);
    pendingAuth.delete(phone);
    await session.client.destroy();

    res.json({
      success: true,
      userId: (user as any)?.id?.toString() ?? null,
      firstName: (user as any)?.firstName ?? null,
    });
  } catch (err: any) {
    const errorMsg: string = err?.errorMessage ?? err?.message ?? "";

    if (
      errorMsg.includes("SESSION_PASSWORD_NEEDED") ||
      err?.constructor?.name === "SessionPasswordNeededError"
    ) {
      session.step = "password";
      res.json({ needPassword: true });
      return;
    }

    res.status(400).json({ error: err?.errorMessage ?? err?.message ?? "UNKNOWN" });
  }
});

// ─── POST /api/auth/verify-password ─────────────────────────────────────────

router.post("/auth/verify-password", async (req, res): Promise<void> => {
  const { phone, password } = req.body as { phone?: string; password?: string };

  if (!phone || !password) {
    res.status(400).json({ error: "phone و password مطلوبان" });
    return;
  }

  const session = pendingAuth.get(phone);
  if (!session || session.step !== "password") {
    res.status(400).json({ error: "لا توجد جلسة تحقق بكلمة مرور نشطة لهذا الرقم." });
    return;
  }

  try {
    const user = await session.client.checkPassword(password);

    await saveSession(phone, session.client);
    pendingAuth.delete(phone);
    await session.client.destroy();

    res.json({
      success: true,
      userId: (user as any)?.id?.toString() ?? null,
      firstName: (user as any)?.firstName ?? null,
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.errorMessage ?? err?.message ?? "UNKNOWN" });
  }
});

// ─── GET /api/auth/status/:phone ─────────────────────────────────────────────

router.get("/auth/status/:phone", async (req, res): Promise<void> => {
  const phone = decodeURIComponent(req.params["phone"] ?? "");

  const [account] = await db
    .select()
    .from(accountsTable)
    .where(eq(accountsTable.phone, phone))
    .limit(1);

  if (!account) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  const hasPending = pendingAuth.has(phone);
  res.json({
    phone,
    hasSession: !!account.sessionString,
    status: account.status,
    hasPendingAuth: hasPending,
    pendingStep: hasPending ? (pendingAuth.get(phone)?.step ?? null) : null,
  });
});

// ─── POST /api/auth/cancel ───────────────────────────────────────────────────

router.post("/auth/cancel", async (req, res): Promise<void> => {
  const { phone } = req.body as { phone?: string };
  if (!phone) {
    res.status(400).json({ error: "phone مطلوب" });
    return;
  }
  const session = pendingAuth.get(phone);
  if (session) {
    await session.client.destroy().catch(() => {});
    pendingAuth.delete(phone);
  }
  res.json({ cancelled: true });
});

export default router;
