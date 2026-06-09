import { Router, type IRouter } from "express";
import { ObjectId } from "mongodb";
import { collections } from "@workspace/db";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

function extractUrlFromDoc(doc: Record<string, any>, linkField: string): string | null {
  const configured = linkField?.trim();
  if (configured && typeof doc[configured] === "string" && doc[configured].includes("t.me")) {
    return doc[configured];
  }
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

function serializeCollection(c: any) {
  return {
    id: c._id.toString(),
    name: c.name,
    connectionString: c.connectionString,
    dbName: c.dbName,
    linkField: c.linkField,
    isActive: c.isActive ?? true,
    lastSyncAt: c.lastSyncAt ? new Date(c.lastSyncAt).toISOString() : null,
    syncedCount: c.syncedCount ?? 0,
    createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: c.updatedAt ? new Date(c.updatedAt).toISOString() : new Date().toISOString(),
  };
}

router.get("/collections", async (req, res): Promise<void> => {
  const col = await collections.mongoCollections();
  const docs = await col.find({}).sort({ createdAt: 1 }).toArray();
  res.json(docs.map(serializeCollection));
});

router.post("/collections", async (req, res): Promise<void> => {
  const body = req.body as any;
  if (!body?.name || !body?.connectionString || !body?.dbName || !body?.linkField) {
    res.status(400).json({ error: "name, connectionString, dbName, linkField are required" });
    return;
  }
  const col = await collections.mongoCollections();
  const now = new Date();
  const result = await col.insertOne({
    _id: new ObjectId(),
    name: body.name,
    connectionString: body.connectionString,
    dbName: body.dbName,
    linkField: body.linkField,
    isActive: body.isActive ?? true,
    lastSyncAt: null,
    syncedCount: 0,
    createdAt: now,
    updatedAt: now,
  });
  const doc = await col.findOne({ _id: result.insertedId });
  res.status(201).json(serializeCollection(doc));
});

router.put("/collections/:id", async (req, res): Promise<void> => {
  const id = req.params["id"];
  if (!id || !ObjectId.isValid(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = req.body as any;
  const updates: Record<string, any> = { updatedAt: new Date() };
  if (body.name !== undefined) updates["name"] = body.name;
  if (body.connectionString !== undefined) updates["connectionString"] = body.connectionString;
  if (body.dbName !== undefined) updates["dbName"] = body.dbName;
  if (body.linkField !== undefined) updates["linkField"] = body.linkField;
  if (body.isActive !== undefined) updates["isActive"] = body.isActive;
  if (Object.keys(updates).length <= 1) { res.status(400).json({ error: "No fields to update" }); return; }
  const col = await collections.mongoCollections();
  const result = await col.findOneAndUpdate(
    { _id: new ObjectId(id) },
    { $set: updates },
    { returnDocument: "after" }
  );
  if (!result) { res.status(404).json({ error: "Collection not found" }); return; }
  res.json(serializeCollection(result));
});

router.delete("/collections/:id", async (req, res): Promise<void> => {
  const id = req.params["id"];
  if (!id || !ObjectId.isValid(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const col = await collections.mongoCollections();
  const result = await col.deleteOne({ _id: new ObjectId(id) });
  if (result.deletedCount === 0) { res.status(404).json({ error: "Collection not found" }); return; }
  res.sendStatus(204);
});

router.post("/collections/:id/sync", async (req, res): Promise<void> => {
  const id = req.params["id"];
  if (!id || !ObjectId.isValid(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const col = await collections.mongoCollections();
  const collection = await col.findOne({ _id: new ObjectId(id) });
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
      const extCol = mongoDb.collection(collection.name);
      const docs = await extCol.find({}).limit(10000).toArray();

      const targetLinksCol = await collections.targetLinks();
      for (const doc of docs) {
        const rawUrl = extractUrlFromDoc(doc as Record<string, any>, collection.linkField);
        if (!rawUrl) continue;
        const url = normaliseUrl(rawUrl);
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
          if (e.code === 11000) { duplicates++; } else { errors++; }
        }
      }
    } finally {
      await client.close();
    }

    await col.updateOne(
      { _id: new ObjectId(id) },
      { $set: { lastSyncAt: new Date(), syncedCount: (collection.syncedCount ?? 0) + synced, updatedAt: new Date() } }
    );
  } catch (e) {
    logger.error({ err: e }, "MongoDB sync failed");
    res.status(500).json({ error: String(e) });
    return;
  }

  logger.info({ collection: collection.name, synced, duplicates, errors }, "Collection sync complete");
  res.json({ synced, duplicates, errors });
});

export default router;
