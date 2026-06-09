/**
 * TELEGRAM CLIENT POOL
 *
 * Manages a pool of TelegramClient instances — one per phone number.
 * Uses MemoryStorage (NO SQLite / better-sqlite3).
 * Session strings are imported from MongoDB accounts collection on client creation.
 * API credentials read from MongoDB settings collection (or env vars).
 */

import { TelegramClient } from "@mtcute/node";
import { MemoryStorage } from "@mtcute/core";
import { logger } from "./logger.js";
import { getSettings } from "@workspace/db";
import type { DeviceProfile } from "./deviceProfiles.js";

interface CachedClient {
  client: TelegramClient;
  lastUsed: Date;
  phone: string;
}

const pool = new Map<string, CachedClient>();

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

  const kv = await getSettings();
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

export async function getClient(
  phone: string,
  sessionString?: string | null,
  deviceProfile?: DeviceProfile | null | Record<string, any>
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

  if (deviceProfile && (deviceProfile as any).deviceModel) {
    const dp = deviceProfile as DeviceProfile;
    clientOptions["deviceModel"] = dp.deviceModel;
    clientOptions["systemVersion"] = dp.systemVersion;
    clientOptions["appVersion"] = dp.appVersion;
    clientOptions["systemLangCode"] = dp.systemLangCode;
    clientOptions["langPack"] = dp.langPack;
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
  logger.info({ phone, device: (deviceProfile as any)?.deviceModel ?? "default" }, "TelegramClient connected");
  return client;
}

export async function createTempClient(): Promise<TelegramClient> {
  const { apiId, apiHash } = await getApiCredentials();
  return new TelegramClient({ apiId, apiHash, storage: new MemoryStorage() });
}

export async function removeClient(phone: string): Promise<void> {
  const cached = pool.get(phone);
  if (cached) {
    pool.delete(phone);
    try { await cached.client.destroy(); } catch (_) {}
    logger.info({ phone }, "TelegramClient removed from pool");
  }
}

export async function exportClientSession(phone: string): Promise<string | null> {
  const cached = pool.get(phone);
  if (!cached) return null;
  try { return await cached.client.exportSession(); } catch (_) { return null; }
}

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
