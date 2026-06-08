/**
 * MONGODB SESSION BACKUP
 *
 * Backs up and restores Telegram account sessions to/from MongoDB.
 * Collection: `tg_sessions`
 *
 * Config priority:
 *   1. settings table (mongo_backup_url / mongo_backup_db)
 *   2. MONGODB_URL env var (database name extracted from URL or defaults to Joining_links)
 */

import { db, accountsTable, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";

async function getBackupConfig(): Promise<{ url: string; dbName: string } | null> {
  // 1. Try settings table first
  try {
    const rows = await db.select().from(settingsTable);
    const kv: Record<string, string> = {};
    for (const r of rows) kv[r.key] = r.value;

    const url = kv["mongo_backup_url"]?.trim();
    if (url) {
      const dbName = kv["mongo_backup_db"]?.trim() || extractDbName(url) || "Joining_links";
      return { url, dbName };
    }
  } catch {
    // ignore — fall through to env var
  }

  // 2. Fall back to MONGODB_URL env var
  const envUrl = process.env["MONGODB_URL"]?.trim();
  if (envUrl) {
    const dbName = extractDbName(envUrl) || "Joining_links";
    return { url: envUrl, dbName };
  }

  return null;
}

/** Extract database name from a MongoDB connection string if present */
function extractDbName(url: string): string | null {
  try {
    // mongodb+srv://user:pass@cluster.net/dbname?options
    const match = url.match(/\/([^/?]+)\??/);
    if (match && match[1] && match[1] !== "" && !match[1].startsWith("mongodb")) {
      return match[1];
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Import ALL accounts from MongoDB into PostgreSQL.
 * Creates new accounts if they don't exist, updates existing ones.
 * This is the primary import path for accounts stored in tg_sessions.
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
    const col = mongoDb.collection("tg_sessions");

    const docs = await col.find({}).toArray();
    total = docs.length;

    if (total === 0) {
      logger.warn({ dbName: config.dbName }, "tg_sessions collection is empty");
      return { imported: 0, updated: 0, skipped: 0, errors: 0, total: 0 };
    }

    for (const doc of docs) {
      const phone = String(doc["phone"] ?? "").trim();
      if (!phone || phone.length < 5) {
        skipped++;
        continue;
      }

      const sessionString = (doc["sessionString"] ?? doc["session_string"] ?? null) as string | null;
      const label = (doc["label"] ?? null) as string | null;
      const rawStatus = String(doc["status"] ?? "active");
      const status = rawStatus === "paused" ? "paused" : "active";
      const joinedCount = Number(doc["joinedCount"] ?? doc["joined_count"] ?? 0);
      const deviceModel = (doc["deviceModel"] ?? doc["device_model"] ?? null) as string | null;
      const systemVersion = (doc["systemVersion"] ?? doc["system_version"] ?? null) as string | null;

      try {
        // Check if account already exists
        const existing = await db
          .select({ id: accountsTable.id, sessionString: accountsTable.sessionString })
          .from(accountsTable)
          .where(eq(accountsTable.phone, phone))
          .limit(1);

        if (existing.length === 0) {
          // Insert new account
          await db.insert(accountsTable).values({
            phone,
            label,
            status,
            sessionString,
            joinedCount,
            deviceModel,
            systemVersion,
          });
          imported++;
          logger.info({ phone, label }, "Imported account from MongoDB");
        } else {
          // Update existing account — only overwrite session if we have a better one
          const updates: Partial<typeof accountsTable.$inferInsert> = {};
          if (label) updates.label = label;
          if (deviceModel) updates.deviceModel = deviceModel;
          if (systemVersion) updates.systemVersion = systemVersion;
          if (joinedCount > 0) updates.joinedCount = joinedCount;
          // Only restore session if existing one is missing
          if (sessionString && !existing[0]?.sessionString) {
            updates.sessionString = sessionString;
          }

          if (Object.keys(updates).length > 0) {
            await db
              .update(accountsTable)
              .set(updates)
              .where(eq(accountsTable.phone, phone));
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
 * Backup all account sessions to MongoDB.
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
 * Restore sessions from MongoDB for accounts that are missing a session string.
 * Only updates existing accounts — use importAccountsFromMongo() to also create new ones.
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
