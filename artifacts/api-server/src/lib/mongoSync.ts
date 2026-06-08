/**
 * MONGODB AUTO-SYNC
 *
 * Periodically syncs all active MongoDB collections into group_links (pending queue).
 * Default interval: 30 minutes. Runs in background alongside the bot engine.
 *
 * Deduplication: unique constraint on URL catches duplicates silently.
 * Each sync logs a summary to activity_log.
 */

import { eq } from "drizzle-orm";
import { db, collectionsTable, groupLinksTable, activityLogTable } from "@workspace/db";
import { logger } from "./logger.js";

let syncTimer: NodeJS.Timeout | null = null;
const DEFAULT_INTERVAL_MS = 30 * 60_000; // 30 minutes

export function startAutoSync(intervalMs = DEFAULT_INTERVAL_MS): void {
  if (syncTimer) return;
  logger.info({ intervalMinutes: intervalMs / 60_000 }, "MongoDB auto-sync started");
  syncTimer = setInterval(() => {
    runSyncAll().catch((err) => logger.error({ err }, "Auto-sync error"));
  }, intervalMs);
  // Run once immediately on startup
  runSyncAll().catch((err) => logger.error({ err }, "Initial auto-sync error"));
}

export function stopAutoSync(): void {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
}

export async function runSyncAll(): Promise<void> {
  const collections = await db
    .select()
    .from(collectionsTable)
    .where(eq(collectionsTable.isActive, true));

  if (collections.length === 0) return;

  logger.info({ count: collections.length }, "Auto-syncing MongoDB collections");

  for (const collection of collections) {
    await syncOne(collection);
  }
}

export async function syncOne(
  collection: typeof collectionsTable.$inferSelect
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
      const col = mongoDb.collection(collection.name);
      // Fetch all fields so we can auto-detect the URL field if the configured one is wrong
      const docs = await col
        .find({})
        .limit(10000)
        .toArray();

      for (const doc of docs) {
        // 1. Try the configured field name first
        let rawUrl: string | null = null;
        const configuredField = collection.linkField?.trim();
        if (configuredField && typeof doc[configuredField] === "string") {
          rawUrl = doc[configuredField];
        }

        // 2. If not found (or empty), scan ALL string fields for a t.me / telegram URL
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
          await db.insert(groupLinksTable).values({ url, source: collection.name });
          synced++;
        } catch (e: any) {
          if (e?.code === "23505") {
            duplicates++;
          } else {
            errors++;
            logger.warn({ url, err: e?.message }, "Failed to insert link during sync");
          }
        }
      }
    } finally {
      await client.close();
    }

    await db
      .update(collectionsTable)
      .set({
        lastSyncAt: new Date(),
        syncedCount: collection.syncedCount + synced,
      })
      .where(eq(collectionsTable.id, collection.id));

    logger.info({ collection: collection.name, synced, duplicates, errors }, "Collection sync complete");

    if (synced > 0) {
      await db.insert(activityLogTable).values({
        type: "sync_completed",
        message: `🔄 تزامن تلقائي: ${collection.name} — ${synced} رابط جديد, ${duplicates} مكرر`,
        accountPhone: null,
        linkUrl: null,
        errorCode: null,
        waitSeconds: null,
      });
    }
  } catch (err) {
    errors++;
    logger.error({ err, collection: collection.name }, "MongoDB sync failed");
  }

  return { synced, duplicates, errors };
}
