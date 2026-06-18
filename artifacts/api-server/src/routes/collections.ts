import { Router, type IRouter } from "express";
import { ObjectId } from "mongodb";
import { collections } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { eventBus } from "../lib/eventBus.js";

const router: IRouter = Router();

function extractUrlFromDoc(doc: Record<string, any>, linkField: string): string | null {
  const configured = linkField?.trim();
  if (configured && typeof doc[configured] === "string" && doc[configured].length > 3) {
    const v = doc[configured];
    if (v.includes("t.me") || v.startsWith("@") || v.startsWith("http")) return v;
  }
  for (const val of Object.values(doc)) {
    if (typeof val === "string" && (val.includes("t.me/") || val.startsWith("@"))) {
      return val;
    }
  }
  return null;
}

function normaliseUrl(raw: string): string {
  let url = raw.trim().replace(/[,;.،؛\s]+$/, "");
  if (url.startsWith("@")) return `https://t.me/${url.slice(1)}`;
  if (url.startsWith("t.me")) return `https://${url}`;
  if (!url.startsWith("http")) return `https://t.me/${url}`;
  return url;
}

function serializeCollection(c: any) {
  return {
    id: c._id.toString(),
    name: c.name,
    connectionString: c.type === "internal" ? "" : c.connectionString,
    dbName: c.dbName,
    linkField: c.linkField,
    specialty: c.specialty ?? null,
    type: c.type ?? "external",
    isActive: c.isActive ?? true,
    lastSyncAt: c.lastSyncAt ? new Date(c.lastSyncAt).toISOString() : null,
    syncedCount: c.totalInQueue ?? c.syncedCount ?? 0,
    createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: c.updatedAt ? new Date(c.updatedAt).toISOString() : new Date().toISOString(),
  };
}

router.get("/collections", async (req, res): Promise<void> => {
  const col = await collections.mongoCollections();
  const docs = await col.find({}).sort({ createdAt: 1 }).toArray();
  const targetLinksCol = await collections.targetLinks();

  // Count actual links in queue per collection source
  const withCounts = await Promise.all(
    docs.map(async (doc) => {
      const totalInQueue = await targetLinksCol.countDocuments({ source: doc.name });
      return { ...doc, totalInQueue };
    })
  );

  res.json(withCounts.map(serializeCollection));
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
    specialty: body.specialty ?? null,
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
  if (body.specialty !== undefined) updates["specialty"] = body.specialty || null;
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

// ─── Background sync — returns immediately, emits progress via SSE ────────────
router.post("/collections/:id/sync", async (req, res): Promise<void> => {
  const id = req.params["id"];
  if (!id || !ObjectId.isValid(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const col = await collections.mongoCollections();
  const collection = await col.findOne({ _id: new ObjectId(id) });
  if (!collection) { res.status(404).json({ error: "Collection not found" }); return; }
  // Internal specialty collections have no external MongoDB source — cannot be synced
  if ((collection as any).type === "internal") {
    res.status(400).json({ error: "Internal specialty collections cannot be synced — they are managed automatically" });
    return;
  }

  // Return immediately — sync runs in background
  res.json({ ok: true, background: true, message: "Sync started in background" });

  // Run sync without awaiting — progress emitted via SSE
  runSyncBackground(collection, id).catch((err) => {
    logger.error({ err, collectionId: id }, "Background sync crashed");
    eventBus.publish({
      type: "sync_error",
      collectionId: id,
      collectionName: collection.name,
      message: `❌ فشل Sync: ${String(err)}`,
      timestamp: new Date().toISOString(),
    });
  });
});

async function runSyncBackground(collection: any, id: string): Promise<void> {
  const ts = () => new Date().toISOString();
  const name = collection.name;

  eventBus.publish({
    type: "sync_progress",
    collectionId: id,
    collectionName: name,
    message: `🔌 الاتصال بـ MongoDB...`,
    total: 0,
    processed: 0,
    timestamp: ts(),
  });

  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(collection.connectionString, {
    serverSelectionTimeoutMS: 20_000,
    connectTimeoutMS: 20_000,
  });

  try {
    await client.connect();

    eventBus.publish({
      type: "sync_progress",
      collectionId: id,
      collectionName: name,
      message: `📥 جاري جلب الوثائق من "${name}"...`,
      total: 0,
      processed: 0,
      timestamp: ts(),
    });

    const mongoDb = client.db(collection.dbName);
    const extCol = mongoDb.collection(collection.name);
    const docs = await extCol.find({}).limit(10_000).toArray();
    const total = docs.length;

    logger.info({ collection: name, fetched: total }, "Fetched docs for manual sync");

    eventBus.publish({
      type: "sync_progress",
      collectionId: id,
      collectionName: name,
      message: `📦 جُلب ${total.toLocaleString()} وثيقة — جاري المعالجة...`,
      total,
      processed: 0,
      timestamp: ts(),
    });

    // Extract and normalise URLs
    const urls: string[] = [];
    for (const doc of docs) {
      const rawUrl = extractUrlFromDoc(doc as Record<string, any>, collection.linkField);
      if (!rawUrl) continue;
      urls.push(normaliseUrl(rawUrl));
    }

    const validCount = urls.length;

    eventBus.publish({
      type: "sync_progress",
      collectionId: id,
      collectionName: name,
      message: `🔗 ${validCount.toLocaleString()} رابط صالح — جاري الإدراج...`,
      total,
      processed: validCount,
      timestamp: ts(),
    });

    let synced = 0;
    let duplicates = 0;
    let errors = 0;

    if (validCount > 0) {
      const targetLinksCol = await collections.targetLinks();
      const now = new Date();
      const linkSpecialty: string | null = collection.specialty ?? null;
      const bulkOps = urls.map((url) => ({
        insertOne: {
          document: {
            _id: new ObjectId(),
            url,
            status: "pending",
            failReason: null,
            groupTitle: null,
            groupType: null,
            source: name,
            specialty: linkSpecialty,
            usedByAccountPhone: null,
            retryCount: 0,
            retryAfter: null,
            createdAt: now,
            processedAt: null,
          },
        },
      }));

      try {
        const result = await targetLinksCol.bulkWrite(bulkOps, { ordered: false });
        synced = result.insertedCount;
        const writeErrors: any[] = (result as any).getWriteErrors?.() ?? [];
        for (const e of writeErrors) {
          if (e.code === 11000) duplicates++;
          else errors++;
        }
      } catch (bulkErr: any) {
        if (bulkErr?.result) {
          synced = bulkErr.result.nInserted ?? 0;
          const writeErrors: any[] = bulkErr.result.getWriteErrors?.() ?? [];
          for (const e of writeErrors) {
            if (e.code === 11000) duplicates++;
            else errors++;
          }
        } else {
          errors = validCount;
          logger.error({ err: bulkErr?.message, collection: name }, "BulkWrite failed");
        }
      }
    }

    // Update collection metadata
    const col = await collections.mongoCollections();
    await col.updateOne(
      { _id: collection._id },
      {
        $set: {
          lastSyncAt: new Date(),
          syncedCount: (collection.syncedCount ?? 0) + synced,
          updatedAt: new Date(),
        },
      }
    );

    logger.info({ collection: name, synced, duplicates, errors }, "Manual sync complete");

    eventBus.publish({
      type: "sync_complete",
      collectionId: id,
      collectionName: name,
      synced,
      duplicates,
      errors,
      total,
      processed: validCount,
      message: `✅ ${name}: ${synced.toLocaleString()} جديد — ${duplicates.toLocaleString()} مكرر`,
      timestamp: ts(),
    });

  } catch (err: any) {
    logger.error({ err, collection: name }, "Sync background failed");
    throw err;
  } finally {
    await client.close();
  }
}

export default router;
