/**
 * MONGODB AUTO-SYNC
 *
 * Periodically syncs all active external MongoDB collections into TARGET_LINKS.
 * Default interval: 30 minutes.
 * Uses mongo_collections collection for config (instead of PostgreSQL).
 */

import { ObjectId } from "mongodb";
import { collections, getSettings } from "@workspace/db";
import { logger } from "./logger.js";

let syncTimer: NodeJS.Timeout | null = null;
const DEFAULT_INTERVAL_MS = 30 * 60_000;

export function startAutoSync(intervalMs = DEFAULT_INTERVAL_MS): void {
  if (syncTimer) return;
  logger.info({ intervalMinutes: intervalMs / 60_000 }, "MongoDB auto-sync started");
  syncTimer = setInterval(() => {
    runSyncAll().catch((err) => logger.error({ err }, "Auto-sync error"));
  }, intervalMs);
  runSyncAll().catch((err) => logger.error({ err }, "Initial auto-sync error"));
}

export function stopAutoSync(): void {
  if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
}

export async function runSyncAll(): Promise<void> {
  const col = await collections.mongoCollections();
  const mongoCollections = await col.find({ isActive: true }).toArray();
  if (mongoCollections.length === 0) return;
  logger.info({ count: mongoCollections.length }, "Auto-syncing MongoDB collections");
  for (const collection of mongoCollections) {
    await syncOne(collection);
  }
}

export async function syncOne(
  collection: any
): Promise<{ synced: number; duplicates: number; errors: number }> {
  let synced = 0;
  let duplicates = 0;
  let errors = 0;

  try {
    const { MongoClient } = await import("mongodb");
    const client = new MongoClient(collection.connectionString, {
      serverSelectionTimeoutMS: 10_000,
      connectTimeoutMS: 10_000,
    });
    await client.connect();

    try {
      const mongoDb = client.db(collection.dbName);
      const extCol = mongoDb.collection(collection.name);
      const docs = await extCol.find({}).limit(10000).toArray();
      const targetLinksCol = await collections.targetLinks();

      for (const doc of docs) {
        let rawUrl: string | null = null;
        const configuredField = collection.linkField?.trim();
        if (configuredField && typeof doc[configuredField] === "string") {
          rawUrl = doc[configuredField];
        }
        if (!rawUrl || (!rawUrl.includes("t.me") && !rawUrl.startsWith("@") && !rawUrl.startsWith("http"))) {
          for (const val of Object.values(doc)) {
            if (typeof val === "string" && (val.includes("t.me/") || val.startsWith("@"))) {
              rawUrl = val;
              break;
            }
          }
        }
        if (!rawUrl) continue;
        let url = rawUrl.trim().replace(/[,;.،؛\s]+$/, "");
        if (!url.startsWith("http") && !url.startsWith("t.me") && !url.startsWith("@")) continue;
        if (url.startsWith("@")) url = `https://t.me/${url.slice(1)}`;
        else if (url.startsWith("t.me")) url = `https://${url}`;

        try {
          await targetLinksCol.insertOne({
            _id: new ObjectId(),
            url,
            status: "pending",
            failReason: null,
            groupTitle: null,
            groupType: null,
            source: collection.name,
            usedByAccountPhone: null,
            retryCount: 0,
            retryAfter: null,
            createdAt: new Date(),
            processedAt: null,
          });
          synced++;
        } catch (e: any) {
          if (e?.code === 11000) { duplicates++; }
          else { errors++; logger.warn({ url, err: e?.message }, "Failed to insert link during sync"); }
        }
      }
    } finally {
      await client.close();
    }

    const col = await collections.mongoCollections();
    await col.updateOne(
      { _id: collection._id },
      { $set: { lastSyncAt: new Date(), syncedCount: (collection.syncedCount ?? 0) + synced, updatedAt: new Date() } }
    );

    logger.info({ collection: collection.name, synced, duplicates, errors }, "Collection sync complete");

    if (synced > 0) {
      const activityCol = await collections.activityLog();
      await activityCol.insertOne({
        _id: new ObjectId(),
        type: "sync_completed",
        message: `🔄 تزامن تلقائي: ${collection.name} — ${synced} رابط جديد, ${duplicates} مكرر`,
        accountPhone: null,
        linkUrl: null,
        errorCode: null,
        waitSeconds: null,
        createdAt: new Date(),
      });
    }
  } catch (err) {
    errors++;
    logger.error({ err, collection: collection.name }, "MongoDB sync failed");
  }

  return { synced, duplicates, errors };
}
