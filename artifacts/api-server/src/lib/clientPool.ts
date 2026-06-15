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

/**
 * Mutex map: prevents two concurrent getClient() calls for the same phone
 * from both creating a new connection (race condition → AUTH_KEY_DUPLICATED).
 */
const creating = new Map<string, Promise<TelegramClient>>();

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

/**
 * Returns the existing pooled client for this phone WITHOUT creating a new one.
 * Use this whenever you only want to READ data (e.g. message history) and must
 * not risk a duplicate connection that would trigger AUTH_KEY_DUPLICATED.
 * Returns null if no active connection exists for this phone.
 */
export function getPooledClientOnly(phone: string): TelegramClient | null {
  const cached = pool.get(phone);
  if (cached) {
    cached.lastUsed = new Date();
    return cached.client;
  }
  return null;
}

export async function getClient(
  phone: string,
  sessionString?: string | null,
  deviceProfile?: DeviceProfile | null | Record<string, any>
): Promise<TelegramClient> {
  // Return pooled client immediately if it exists
  const cached = pool.get(phone);
  if (cached) {
    cached.lastUsed = new Date();
    return cached.client;
  }

  // Mutex: if another async call is already creating a client for this phone,
  // wait for it instead of creating a second connection (AUTH_KEY_DUPLICATED).
  const inFlight = creating.get(phone);
  if (inFlight) {
    logger.debug({ phone }, "Waiting for in-flight client creation");
    return inFlight;
  }

  const promise = (async (): Promise<TelegramClient> => {
    try {
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
          // CRITICAL SAFETY RULE: NEVER connect fresh when we have a stored session.
          // Connecting with an empty MemoryStorage creates a brand-new auth key.
          // Telegram will then detect two auth keys for the same account →
          // AUTH_KEY_DUPLICATED → the engine wipes the session from DB → user must re-login.
          // This is the #1 cause of repeated re-authentication. Fail hard instead.
          logger.error({ phone, err }, "CRITICAL: Failed to import stored session — refusing to connect fresh. Stored session is protected.");
          throw new Error(
            `Cannot connect ${phone}: importSession failed (${(err as any)?.message ?? err}). ` +
            `Refusing to connect fresh to protect the stored session in MongoDB. ` +
            `Delete the account and re-add it if the session is genuinely corrupted.`
          );
        }
      }

      await client.connect();

      // After a successful connect with an imported session, export the refreshed session
      // string and save it back to MongoDB. This keeps the DB in sync with the latest
      // session state and prevents stale session issues on the next restart.
      if (sessionString) {
        try {
          const refreshedSession = await client.exportSession();
          if (refreshedSession && refreshedSession !== sessionString) {
            const { collections } = await import("@workspace/db");
            const col = await collections.accounts();
            await col.updateOne(
              { phone },
              { $set: { sessionString: refreshedSession, updatedAt: new Date() } }
            );
            logger.debug({ phone }, "Session string refreshed in MongoDB after connect");
          }
        } catch (saveErr) {
          // Non-fatal: log and continue — the old session is still valid
          logger.warn({ phone, err: saveErr }, "Could not refresh session in MongoDB after connect — continuing with existing");
        }
      }

      pool.set(phone, { client, lastUsed: new Date(), phone });
      logger.info({ phone, device: (deviceProfile as any)?.deviceModel ?? "default" }, "TelegramClient connected");
      return client;
    } finally {
      creating.delete(phone);
    }
  })();

  creating.set(phone, promise);
  return promise;
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
