/**
 * TELEGRAM CLIENT POOL
 *
 * Manages a pool of TelegramClient instances — one per phone number.
 * Uses MemoryStorage (NO SQLite / better-sqlite3).
 * Session strings are imported from PostgreSQL on client creation.
 */

import { TelegramClient } from "@mtcute/node";
import { MemoryStorage } from "@mtcute/core";
import { logger } from "./logger.js";
import { db, settingsTable } from "@workspace/db";
import type { DeviceProfile } from "./deviceProfiles.js";

interface CachedClient {
  client: TelegramClient;
  lastUsed: Date;
  phone: string;
}

const pool = new Map<string, CachedClient>();

// Cache DB credentials to avoid a DB hit on every client creation
let cachedApiId: number | null = null;
let cachedApiHash: string | null = null;

export function invalidateCredentialsCache(): void {
  cachedApiId = null;
  cachedApiHash = null;
}

async function getApiCredentials(): Promise<{ apiId: number; apiHash: string }> {
  const envApiId = Number(process.env["TELEGRAM_API_ID"]);
  const envApiHash = process.env["TELEGRAM_API_HASH"] ?? "";
  if (envApiId && envApiHash) return { apiId: envApiId, apiHash: envApiHash };

  if (cachedApiId && cachedApiHash) return { apiId: cachedApiId, apiHash: cachedApiHash };

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
 * Uses MemoryStorage — no SQLite files.
 * If sessionString is provided, the session is imported so no re-auth is needed.
 */
export async function getClient(
  phone: string,
  sessionString?: string | null,
  deviceProfile?: DeviceProfile | null
): Promise<TelegramClient> {
  const cached = pool.get(phone);
  if (cached) {
    cached.lastUsed = new Date();
    return cached.client;
  }

  const { apiId, apiHash } = await getApiCredentials();

  const clientOptions: Record<string, unknown> = {
    apiId,
    apiHash,
    storage: new MemoryStorage(),
  };

  if (deviceProfile) {
    clientOptions["deviceModel"] = deviceProfile.deviceModel;
    clientOptions["systemVersion"] = deviceProfile.systemVersion;
    clientOptions["appVersion"] = deviceProfile.appVersion;
    clientOptions["systemLangCode"] = deviceProfile.systemLangCode;
    clientOptions["langPack"] = deviceProfile.langPack;
  }

  const client = new TelegramClient(clientOptions as any);

  if (sessionString) {
    try {
      await client.importSession(sessionString);
    } catch (err) {
      logger.warn({ phone, err }, "Failed to import session string, will connect fresh");
    }
  }

  await client.connect();

  pool.set(phone, { client, lastUsed: new Date(), phone });
  logger.info({ phone, device: deviceProfile?.deviceModel ?? "default" }, "TelegramClient connected");
  return client;
}

/**
 * Create a temporary TelegramClient for auth flow — uses MemoryStorage.
 */
export async function createTempClient(): Promise<TelegramClient> {
  const { apiId, apiHash } = await getApiCredentials();
  return new TelegramClient({ apiId, apiHash, storage: new MemoryStorage() });
}

/**
 * Remove and destroy a cached client.
 */
export async function removeClient(phone: string): Promise<void> {
  const cached = pool.get(phone);
  if (cached) {
    pool.delete(phone);
    try { await cached.client.destroy(); } catch (_) {}
    logger.info({ phone }, "TelegramClient removed from pool");
  }
}

/**
 * Export the current session string from a cached client.
 */
export async function exportClientSession(phone: string): Promise<string | null> {
  const cached = pool.get(phone);
  if (!cached) return null;
  try { return await cached.client.exportSession(); } catch (_) { return null; }
}

/**
 * Clean up clients idle longer than maxIdleMs (default 30 minutes).
 */
export async function cleanupIdleClients(maxIdleMs = 30 * 60 * 1000): Promise<void> {
  const now = Date.now();
  for (const [phone, entry] of pool.entries()) {
    if (now - entry.lastUsed.getTime() > maxIdleMs) {
      pool.delete(phone);
      try { await entry.client.destroy(); } catch (_) {}
      logger.info({ phone }, "Idle TelegramClient cleaned up");
    }
  }
}

export function getPooledPhones(): string[] {
  return [...pool.keys()];
}
