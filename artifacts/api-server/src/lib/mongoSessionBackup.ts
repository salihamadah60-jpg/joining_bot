/**
 * MONGODB SESSION BACKUP
 *
 * Backs up and restores Telegram account sessions to/from MongoDB tg_sessions.
 * Since accounts are now stored in MongoDB, this syncs between:
 *   accounts collection (primary) ←→ tg_sessions collection (backup/import source)
 *
 * Config priority:
 *   1. settings collection (mongo_backup_url / mongo_backup_db)
 *   2. MONGODB_URL env var
 */

import { ObjectId } from "mongodb";
import { collections, getSettings } from "@workspace/db";
import { logger } from "./logger.js";

async function getBackupConfig(): Promise<{ url: string; dbName: string } | null> {
  try {
    const kv = await getSettings();
    const url = kv["mongo_backup_url"]?.trim();
    if (url) {
      const dbName = kv["mongo_backup_db"]?.trim() || extractDbName(url) || "Joining_links";
      return { url, dbName };
    }
  } catch {}

  const envUrl = process.env["MONGODB_URL"]?.trim();
  if (envUrl) {
    const dbName = extractDbName(envUrl) || "Joining_links";
    return { url: envUrl, dbName };
  }
  return null;
}

function extractDbName(url: string): string | null {
  try {
    const match = url.match(/\/([^/?]+)\??/);
    if (match && match[1] && match[1] !== "" && !match[1].startsWith("mongodb")) {
      return match[1];
    }
  } catch {}
  return null;
}

/**
 * Import ALL accounts from MongoDB tg_sessions into the accounts collection.
 * Creates new accounts if they don't exist, updates existing ones.
 */
export async function importAccountsFromMongo(): Promise<{
  imported: number;
  updated: number;
  skipped: number;
  errors: number;
  total: number;
}> {
  const config = await getBackupConfig();
  if (!config) {
    throw new Error("لم يتم إعداد رابط MongoDB. أضف MONGODB_URL في متغيرات البيئة أو في الإعدادات.");
  }

  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(config.url, {
    serverSelectionTimeoutMS: 15_000,
    connectTimeoutMS: 15_000,
  });

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  let total = 0;

  try {
    await client.connect();
    const mongoDb = client.db(config.dbName);
    const tgSessions = mongoDb.collection("tg_sessions");
    const docs = await tgSessions.find({}).toArray();
    total = docs.length;

    if (total === 0) {
      logger.warn({ dbName: config.dbName }, "tg_sessions collection is empty");
      return { imported: 0, updated: 0, skipped: 0, errors: 0, total: 0 };
    }

    const accountsCol = await collections.accounts();

    for (const doc of docs) {
      const phone = String(doc["phone"] ?? "").trim();
      if (!phone || phone.length < 5) { skipped++; continue; }

      const sessionString = (doc["sessionString"] ?? doc["session_string"] ?? null) as string | null;
      const label = (doc["label"] ?? null) as string | null;
      const rawStatus = String(doc["status"] ?? "active");
      const status = rawStatus === "paused" ? "paused" : "active";
      const joinedCount = Number(doc["joinedCount"] ?? doc["joined_count"] ?? 0);
      const deviceModel = (doc["deviceModel"] ?? doc["device_model"] ?? null) as string | null;
      const systemVersion = (doc["systemVersion"] ?? doc["system_version"] ?? null) as string | null;

      try {
        const existing = await accountsCol.findOne({ phone }, { projection: { _id: 1, sessionString: 1 } });

        if (!existing) {
          const { getDeviceProfileForPhone } = await import("./deviceProfiles.js");
          const device = getDeviceProfileForPhone(phone);
          const now = new Date();
          await accountsCol.insertOne({
            _id: new ObjectId(),
            phone,
            label,
            status,
            sessionString,
            joinedCount,
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
            deviceModel: deviceModel ?? device.deviceModel,
            systemVersion: systemVersion ?? device.systemVersion,
            appVersion: device.appVersion,
            systemLangCode: device.systemLangCode,
            createdAt: now,
            updatedAt: now,
          });
          imported++;
          logger.info({ phone, label }, "Imported account from MongoDB");
        } else {
          const updates: Record<string, any> = { updatedAt: new Date() };
          if (label) updates["label"] = label;
          if (deviceModel) updates["deviceModel"] = deviceModel;
          if (systemVersion) updates["systemVersion"] = systemVersion;
          if (joinedCount > 0) updates["joinedCount"] = joinedCount;
          if (sessionString && !existing.sessionString) updates["sessionString"] = sessionString;

          if (Object.keys(updates).length > 1) {
            await accountsCol.updateOne({ phone }, { $set: updates });
            updated++;
          } else {
            skipped++;
          }
        }
      } catch (err) {
        errors++;
        logger.warn({ phone, err }, "Failed to import account from MongoDB");
      }
    }

    logger.info({ imported, updated, skipped, errors, total }, "MongoDB account import complete");
  } finally {
    await client.close();
  }

  return { imported, updated, skipped, errors, total };
}

/**
 * Backup all account sessions to MongoDB tg_sessions.
 */
export async function backupSessionsToMongo(): Promise<{
  backedUp: number;
  skipped: number;
  errors: number;
  total: number;
}> {
  const config = await getBackupConfig();
  if (!config) {
    throw new Error("لم يتم إعداد رابط MongoDB. أضف MONGODB_URL في متغيرات البيئة أو في الإعدادات.");
  }

  const accountsCol = await collections.accounts();
  const accounts = await accountsCol.find({}).toArray();
  let backedUp = 0;
  let skipped = 0;
  let errors = 0;

  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(config.url, {
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
  });

  try {
    await client.connect();
    const mongoDb = client.db(config.dbName);
    const col = mongoDb.collection("tg_sessions");
    await col.createIndex({ phone: 1 }, { unique: true });

    for (const account of accounts) {
      if (!account.sessionString) { skipped++; continue; }
      try {
        await col.replaceOne(
          { phone: account.phone },
          {
            phone: account.phone,
            sessionString: account.sessionString,
            label: account.label ?? null,
            status: account.status,
            joinedCount: account.joinedCount,
            deviceModel: account.deviceModel ?? null,
            backedUpAt: new Date(),
          },
          { upsert: true }
        );
        backedUp++;
      } catch (err) {
        errors++;
        logger.warn({ phone: account.phone, err }, "Failed to backup session");
      }
    }
    logger.info({ backedUp, skipped, errors }, "Session backup to MongoDB complete");
  } finally {
    await client.close();
  }

  return { backedUp, skipped, errors, total: accounts.length };
}

/**
 * Restore sessions from MongoDB for accounts that are missing a session string.
 */
export async function restoreSessionsFromMongo(): Promise<{
  restored: number;
  skipped: number;
  errors: number;
}> {
  const config = await getBackupConfig();
  if (!config) {
    throw new Error("لم يتم إعداد رابط MongoDB. أضف MONGODB_URL في متغيرات البيئة أو في الإعدادات.");
  }

  const accountsCol = await collections.accounts();
  const accountsWithoutSession = await accountsCol.find({ sessionString: null }).toArray();
  if (accountsWithoutSession.length === 0) return { restored: 0, skipped: 0, errors: 0 };

  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(config.url, {
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
  });

  let restored = 0;
  let skipped = 0;
  let errors = 0;

  try {
    await client.connect();
    const col = client.db(config.dbName).collection("tg_sessions");

    for (const account of accountsWithoutSession) {
      const doc = await col.findOne({ phone: account.phone });
      if (!doc?.sessionString) { skipped++; continue; }
      try {
        await accountsCol.updateOne({ phone: account.phone }, { $set: { sessionString: doc.sessionString, updatedAt: new Date() } });
        restored++;
        logger.info({ phone: account.phone }, "Session restored from MongoDB backup");
      } catch (err) {
        errors++;
        logger.warn({ phone: account.phone, err }, "Failed to restore session");
      }
    }
  } finally {
    await client.close();
  }

  return { restored, skipped, errors };
}

/**
 * List sessions stored in MongoDB (for status display).
 */
export async function listMongoSessions(): Promise<{
  phone: string;
  label: string | null;
  status: string;
  backedUpAt: string;
}[]> {
  const config = await getBackupConfig();
  if (!config) return [];

  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(config.url, {
    serverSelectionTimeoutMS: 8_000,
    connectTimeoutMS: 8_000,
  });

  try {
    await client.connect();
    const col = client.db(config.dbName).collection("tg_sessions");
    const docs = await col
      .find({}, { projection: { phone: 1, label: 1, status: 1, backedUpAt: 1 } })
      .sort({ backedUpAt: -1 })
      .toArray();

    return docs.map((d) => ({
      phone: String(d.phone ?? "").slice(-6),
      label: d.label ?? null,
      status: String(d.status ?? "unknown"),
      backedUpAt: d.backedUpAt ? new Date(d.backedUpAt).toISOString() : "unknown",
    }));
  } finally {
    await client.close();
  }
}
