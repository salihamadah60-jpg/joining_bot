/**
 * TELEGRAM CLIENT POOL
 *
 * Manages a pool of TelegramClient instances — one per phone number.
 * Clients are created on demand and cached.
 * Uses SQLite storage files (one per account) for session persistence.
 * If the session file doesn't exist but a session string is available (from DB),
 * the session is imported so the account can reconnect without re-authentication.
 */

import { TelegramClient } from "@mtcute/node";
import path from "path";
import { fileURLToPath } from "url";
import { mkdirSync } from "fs";
import { logger } from "./logger.js";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SESSIONS_DIR = path.join(__dirname, "../../../../sessions");

mkdirSync(SESSIONS_DIR, { recursive: true });

interface CachedClient {
  client: TelegramClient;
  lastUsed: Date;
  phone: string;
}

const pool = new Map<string, CachedClient>();

function sessionFilePath(phone: string): string {
  const safe = phone.replace(/\D/g, "");
  return path.join(SESSIONS_DIR, `${safe}.db`);
}

// Cache DB credentials to avoid a DB hit on every client creation
let cachedApiId: number | null = null;
let cachedApiHash: string | null = null;

export function invalidateCredentialsCache(): void {
  cachedApiId = null;
  cachedApiHash = null;
}

async function getApiCredentials(): Promise<{ apiId: number; apiHash: string }> {
  // 1. Environment variables take priority
  const envApiId = Number(process.env["TELEGRAM_API_ID"]);
  const envApiHash = process.env["TELEGRAM_API_HASH"] ?? "";
  if (envApiId && envApiHash) {
    return { apiId: envApiId, apiHash: envApiHash };
  }

  // 2. Cached DB values
  if (cachedApiId && cachedApiHash) {
    return { apiId: cachedApiId, apiHash: cachedApiHash };
  }

  // 3. Read from settings table
  const rows = await db.select().from(settingsTable);
  const kv: Record<string, string> = {};
  for (const r of rows) kv[r.key] = r.value;

  const dbApiId = Number(kv["telegram_api_id"]);
  const dbApiHash = kv["telegram_api_hash"] ?? "";

  if (!dbApiId || !dbApiHash) {
    throw new Error(
      "Telegram API credentials not configured. Please add TELEGRAM_API_ID and TELEGRAM_API_HASH via the Settings page or as environment variables."
    );
  }

  cachedApiId = dbApiId;
  cachedApiHash = dbApiHash;
  return { apiId: dbApiId, apiHash: dbApiHash };
}

/**
 * Get or create a connected TelegramClient for the given phone number.
 * @param phone - Phone number in international format (+XXXXXXXXX)
 * @param sessionString - Optional session string from DB for restore if file is missing
 */
export async function getClient(
  phone: string,
  sessionString?: string | null
): Promise<TelegramClient> {
  const cached = pool.get(phone);
  if (cached) {
    cached.lastUsed = new Date();
    return cached.client;
  }

  const { apiId, apiHash } = await getApiCredentials();
  const storagePath = sessionFilePath(phone);

  const client = new TelegramClient({
    apiId,
    apiHash,
    storage: storagePath,
  });

  // If we have a session string backup from DB, import it
  // This allows restoration if the SQLite file was lost (e.g., after redeploy)
  if (sessionString) {
    try {
      await client.importSession(sessionString);
    } catch (err) {
      logger.warn({ phone, err }, "Failed to import session string, will try connecting anyway");
    }
  }

  await client.connect();

  pool.set(phone, { client, lastUsed: new Date(), phone });
  logger.info({ phone }, "TelegramClient connected and cached");
  return client;
}

/**
 * Create a temporary TelegramClient for auth flow (send-code → verify → save session).
 * Does NOT add to pool — caller manages lifecycle.
 */
export async function createTempClient(storagePath: string): Promise<TelegramClient> {
  const { apiId, apiHash } = await getApiCredentials();
  return new TelegramClient({ apiId, apiHash, storage: storagePath });
}

/**
 * Remove and destroy a cached client (e.g., after session revocation).
 */
export async function removeClient(phone: string): Promise<void> {
  const cached = pool.get(phone);
  if (cached) {
    pool.delete(phone);
    try {
      await cached.client.destroy();
    } catch (_) {
      // ignore cleanup errors
    }
    logger.info({ phone }, "TelegramClient removed from pool");
  }
}

/**
 * Export the current session string from a cached client.
 * Used to persist session back to DB after re-auth.
 */
export async function exportClientSession(phone: string): Promise<string | null> {
  const cached = pool.get(phone);
  if (!cached) return null;
  try {
    return await cached.client.exportSession();
  } catch (_) {
    return null;
  }
}

/**
 * Clean up clients idle longer than maxIdleMs (default 30 minutes).
 */
export async function cleanupIdleClients(maxIdleMs = 30 * 60 * 1000): Promise<void> {
  const now = Date.now();
  for (const [phone, entry] of pool.entries()) {
    if (now - entry.lastUsed.getTime() > maxIdleMs) {
      pool.delete(phone);
      try {
        await entry.client.destroy();
      } catch (_) {
        // ignore
      }
      logger.info({ phone }, "Idle TelegramClient cleaned up");
    }
  }
}

/**
 * Return all currently pooled phone numbers (for diagnostics).
 */
export function getPooledPhones(): string[] {
  return [...pool.keys()];
}
