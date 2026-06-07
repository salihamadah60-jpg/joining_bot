/**
 * MONGODB SESSION BACKUP — P3-3
 *
 * Backs up all Telegram account session strings to a MongoDB collection.
 * Acts as a disaster-recovery layer in case PostgreSQL + local SQLite files are lost.
 *
 * Collection: `tg_sessions` in the configured database.
 * Document schema: { phone, sessionString, label, status, backedUpAt }
 */

import { db, accountsTable, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";

async function getBackupConfig(): Promise<{ url: string; dbName: string } | null> {
  const rows = await db.select().from(settingsTable);
  const kv: Record<string, string> = {};
  for (const r of rows) kv[r.key] = r.value;

  const url = kv["mongo_backup_url"]?.trim();
  if (!url) return null;

  const dbName = kv["mongo_backup_db"] || "tg_backup";
  return { url, dbName };
}

/**
 * Backup all account sessions to MongoDB.
 * Returns a summary of backed-up, skipped (no session), and failed accounts.
 */
export async function backupSessionsToMongo(): Promise<{
  backedUp: number;
  skipped: number;
  errors: number;
  total: number;
}> {
  const config = await getBackupConfig();
  if (!config) {
    throw new Error("mongo_backup_url غير مُعيَّن في الإعدادات");
  }

  const accounts = await db.select().from(accountsTable);
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

    // Ensure unique index on phone
    await col.createIndex({ phone: 1 }, { unique: true });

    for (const account of accounts) {
      if (!account.sessionString) {
        skipped++;
        continue;
      }
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
 * Restore sessions from MongoDB into PostgreSQL for any accounts missing a session string.
 * Only restores if the phone already exists in the local accounts table.
 */
export async function restoreSessionsFromMongo(): Promise<{
  restored: number;
  skipped: number;
  errors: number;
}> {
  const config = await getBackupConfig();
  if (!config) {
    throw new Error("mongo_backup_url غير مُعيَّن في الإعدادات");
  }

  const accounts = await db.select().from(accountsTable);
  const accountsWithoutSession = accounts.filter((a) => !a.sessionString);
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
    const mongoDb = client.db(config.dbName);
    const col = mongoDb.collection("tg_sessions");

    for (const account of accountsWithoutSession) {
      const doc = await col.findOne({ phone: account.phone });
      if (!doc?.sessionString) {
        skipped++;
        continue;
      }
      try {
        await db
          .update(accountsTable)
          .set({ sessionString: doc.sessionString })
          .where(eq(accountsTable.phone, account.phone));
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
 * List sessions stored in MongoDB backup (for status display).
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
