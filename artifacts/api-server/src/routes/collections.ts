import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, collectionsTable, groupLinksTable } from "@workspace/db";
import {
  ListCollectionsResponse,
  AddCollectionBody,
  DeleteCollectionParams,
  SyncCollectionParams,
  SyncCollectionResponse,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/** Extract a telegram URL from a MongoDB document.
 * First tries the configured field, then scans all string fields. */
function extractUrlFromDoc(doc: Record<string, any>, linkField: string): string | null {
  // 1. Try configured field
  const configured = linkField?.trim();
  if (configured && typeof doc[configured] === "string" && doc[configured].includes("t.me")) {
    return doc[configured];
  }
  // 2. Scan all string fields for t.me URLs
  for (const val of Object.values(doc)) {
    if (typeof val === "string" && val.includes("t.me/")) {
      return val;
    }
  }
  return null;
}

function normaliseUrl(raw: string): string {
  let url = raw.trim().replace(/[,;.،؛\s]+$/, "");
  if (url.startsWith("@")) return `https://t.me/${url.slice(1)}`;
  if (!url.startsWith("http")) return `https://${url}`;
  return url;
}

router.get("/collections", async (req, res): Promise<void> => {
  const collections = await db.select().from(collectionsTable).orderBy(collectionsTable.createdAt);
  res.json(ListCollectionsResponse.parse(collections.map(serializeCollection)));
});

router.post("/collections", async (req, res): Promise<void> => {
  const parsed = AddCollectionBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [collection] = await db.insert(collectionsTable).values({
    name: parsed.data.name,
    connectionString: parsed.data.connectionString,
    dbName: parsed.data.dbName,
    linkField: parsed.data.linkField,
    isActive: parsed.data.isActive ?? true,
  }).returning();
  res.status(201).json(serializeCollection(collection));
});

/** PUT /collections/:id — update collection settings */
router.put("/collections/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = req.body as Partial<{ name: string; connectionString: string; dbName: string; linkField: string; isActive: boolean }>;
  const updates: Record<string, any> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.connectionString !== undefined) updates.connectionString = body.connectionString;
  if (body.dbName !== undefined) updates.dbName = body.dbName;
  if (body.linkField !== undefined) updates.linkField = body.linkField;
  if (body.isActive !== undefined) updates.isActive = body.isActive;
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No fields to update" }); return; }
  const [updated] = await db.update(collectionsTable).set(updates).where(eq(collectionsTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Collection not found" }); return; }
  res.json(serializeCollection(updated));
});

router.delete("/collections/:id", async (req, res): Promise<void> => {
  const params = DeleteCollectionParams.safeParse({ id: Number(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [deleted] = await db.delete(collectionsTable).where(eq(collectionsTable.id, params.data.id)).returning();
  if (!deleted) { res.status(404).json({ error: "Collection not found" }); return; }
  res.sendStatus(204);
});

router.post("/collections/:id/sync", async (req, res): Promise<void> => {
  const params = SyncCollectionParams.safeParse({ id: Number(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [collection] = await db.select().from(collectionsTable).where(eq(collectionsTable.id, params.data.id));
  if (!collection) { res.status(404).json({ error: "Collection not found" }); return; }

  let synced = 0;
  let duplicates = 0;
  let errors = 0;
  try {
    const { MongoClient } = await import("mongodb");
    const client = new MongoClient(collection.connectionString);
    await client.connect();
    try {
      const mongoDb = client.db(collection.dbName);
      const col = mongoDb.collection(collection.name);
      // Fetch all fields to allow smart URL detection
      const docs = await col.find({}).limit(10000).toArray();

      for (const doc of docs) {
        const rawUrl = extractUrlFromDoc(doc as Record<string, any>, collection.linkField);
        if (!rawUrl) continue;
        const url = normaliseUrl(rawUrl);

        try {
          await db.insert(groupLinksTable).values({ url, source: collection.name });
          synced++;
        } catch (e: any) {
          if (e.code === "23505") { duplicates++; } else { errors++; }
        }
      }
    } finally {
      await client.close();
    }

    await db.update(collectionsTable)
      .set({ lastSyncAt: new Date(), syncedCount: (collection.syncedCount ?? 0) + synced })
      .where(eq(collectionsTable.id, params.data.id));
  } catch (e) {
    logger.error({ err: e }, "MongoDB sync failed");
    res.status(500).json({ error: String(e) });
    return;
  }

  logger.info({ collection: collection.name, synced, duplicates, errors }, "Collection sync complete");
  res.json(SyncCollectionResponse.parse({ synced, duplicates, errors }));
});

function serializeCollection(c: typeof collectionsTable.$inferSelect) {
  return {
    ...c,
    lastSyncAt: c.lastSyncAt ? c.lastSyncAt.toISOString() : null,
    createdAt: c.createdAt.toISOString(),
  };
}

export default router;
