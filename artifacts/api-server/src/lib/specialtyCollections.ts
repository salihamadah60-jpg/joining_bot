/**
 * SPECIALTY COLLECTIONS — AUTO-CREATE
 *
 * When the AI classifies a link under a specialty, this module ensures
 * an "internal" MongoCollection entry exists for that specialty.
 *
 * Internal collections appear on the Collections page with an INTERNAL badge
 * but have no external MongoDB source — they are specialty-based containers
 * that exist purely to track which links belong to which specialty, and to
 * allow accounts to be assigned to them.
 */

import { ObjectId } from "mongodb";
import { collections } from "@workspace/db";
import { SPECIALTY_DISPLAY_NAMES } from "./aiSpecialtyClassifier.js";
import { logger } from "./logger.js";

// In-memory cache to avoid repeated DB lookups in the same server session
const ensuredSpecialties = new Set<string>();

/**
 * Ensure an internal collection entry exists for the given specialty.
 * Creates it automatically if not found. Safe to call multiple times.
 */
function getLocalMongoUrl(): string {
  return process.env["MONGODB_URL"] ?? "";
}

function extractLocalDbName(url: string): string {
  if (!url) return "Joining_links";
  try {
    const normalized = url
      .replace(/^mongodb\+srv:\/\//, "https://")
      .replace(/^mongodb:\/\//, "https://");
    const parsed = new URL(normalized);
    const dbName = parsed.pathname.slice(1).split("?")[0].trim();
    if (dbName && !dbName.includes(".") && dbName !== "") return dbName;
  } catch {}
  return "Joining_links";
}

export async function ensureSpecialtyCollection(specialty: string): Promise<void> {
  if (!specialty || specialty === "all") return;
  if (ensuredSpecialties.has(specialty)) return;

  try {
    const col = await collections.mongoCollections();
    const existing = await col.findOne({ specialty, type: "internal" } as any);
    if (existing) {
      ensuredSpecialties.add(specialty);
      return;
    }

    const displayName = SPECIALTY_DISPLAY_NAMES[specialty] ?? specialty;
    const mongoUrl = getLocalMongoUrl();
    const dbName = extractLocalDbName(mongoUrl);
    const now = new Date();

    await col.insertOne({
      _id: new ObjectId(),
      name: `${displayName}`,
      connectionString: mongoUrl,
      dbName,
      linkField: "url",
      specialty,
      type: "internal",
      isActive: true,
      lastSyncAt: null,
      syncedCount: 0,
      createdAt: now,
      updatedAt: now,
    } as any);

    ensuredSpecialties.add(specialty);
    logger.info({ specialty, displayName }, "Auto-created internal specialty collection");
  } catch (err: any) {
    // Duplicate key = already exists (race condition), not an error
    if (err?.code !== 11000) {
      logger.warn({ err, specialty }, "ensureSpecialtyCollection failed — non-critical");
    }
    ensuredSpecialties.add(specialty);
  }
}

/**
 * Update the synced count on an internal collection (called when new links get its specialty).
 */
export async function incrementSpecialtyCollectionCount(specialty: string, delta = 1): Promise<void> {
  if (!specialty || specialty === "all") return;
  try {
    const col = await collections.mongoCollections();
    await col.updateOne(
      { specialty, type: "internal" } as any,
      { $inc: { syncedCount: delta }, $set: { lastSyncAt: new Date(), updatedAt: new Date() } }
    );
  } catch {
    // Non-critical
  }
}
