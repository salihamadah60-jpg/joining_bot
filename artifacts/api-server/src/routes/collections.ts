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

  // Attempt to connect to MongoDB and sync links
  let synced = 0;
  let duplicates = 0;
  let errors = 0;
  try {
    const { MongoClient } = await import("mongodb");
    const client = new MongoClient(collection.connectionString);
    await client.connect();
    const db2 = client.db(collection.dbName);
    const col = db2.collection(collection.name);
    const docs = await col.find({}, { projection: { [collection.linkField]: 1 } }).toArray();
    for (const doc of docs) {
      const url = doc[collection.linkField];
      if (!url || typeof url !== "string") continue;
      try {
        await db.insert(groupLinksTable).values({ url, source: collection.name });
        synced++;
      } catch (e: any) {
        if (e.code === "23505") { duplicates++; } else { errors++; }
      }
    }
    await client.close();
    await db.update(collectionsTable).set({ lastSyncAt: new Date(), syncedCount: collection.syncedCount + synced }).where(eq(collectionsTable.id, params.data.id));
  } catch (e) {
    logger.error({ err: e }, "MongoDB sync failed");
    errors++;
  }

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
