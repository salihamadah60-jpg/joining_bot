import { Router, type IRouter } from "express";
import { ObjectId } from "mongodb";
import { collections } from "@workspace/db";

const router: IRouter = Router();

/** Extract all valid Telegram URLs from a raw text blob. */
function extractTelegramUrls(rawText: string): string[] {
  const pattern = /(?:https?:\/\/t\.me\/[^\s"'<>\u0600-\u06FF]+|t\.me\/[^\s"'<>\u0600-\u06FF]+|@[a-zA-Z][a-zA-Z0-9_]{3,})/gi;
  const matches = rawText.match(pattern) ?? [];
  const normalised = matches.map((u) => {
    let url = u.trim().replace(/[,;.،؛]+$/, "");
    if (url.startsWith("@")) return `https://t.me/${url.slice(1)}`;
    if (!url.startsWith("http")) return `https://${url}`;
    return url;
  });
  const seen = new Set<string>();
  return normalised.filter((u) => {
    const key = u.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function serializeLink(l: any) {
  return {
    id: l._id.toString(),
    url: l.url,
    status: l.status,
    failReason: l.failReason ?? null,
    groupTitle: l.groupTitle ?? null,
    groupType: l.groupType ?? null,
    source: l.source ?? null,
    usedByAccountPhone: l.usedByAccountPhone ?? null,
    retryCount: l.retryCount ?? 0,
    retryAfter: l.retryAfter ? new Date(l.retryAfter).toISOString() : null,
    createdAt: l.createdAt ? new Date(l.createdAt).toISOString() : new Date().toISOString(),
    processedAt: l.processedAt ? new Date(l.processedAt).toISOString() : null,
  };
}

router.get("/links/stats", async (req, res): Promise<void> => {
  const col = await collections.targetLinks();
  const links = await col.find({}).toArray();
  res.json({
    total: links.length,
    pending: links.filter((l) => l.status === "pending").length,
    joined: links.filter((l) => l.status === "joined").length,
    failed: links.filter((l) => l.status === "failed").length,
    skipped: links.filter((l) => l.status === "skipped").length,
  });
});

router.get("/links", async (req, res): Promise<void> => {
  const col = await collections.targetLinks();
  const filter: Record<string, any> = {};
  if (req.query["status"]) filter["status"] = req.query["status"];
  if (req.query["source"]) filter["source"] = req.query["source"];
  const links = await col.find(filter).sort({ createdAt: 1 }).toArray();
  res.json(links.map(serializeLink));
});

router.post("/links", async (req, res): Promise<void> => {
  const body = req.body as { url?: string; source?: string };
  if (!body?.url || typeof body.url !== "string") {
    res.status(400).json({ error: "url is required" });
    return;
  }
  const col = await collections.targetLinks();
  try {
    const result = await col.insertOne({
      _id: new ObjectId(),
      url: body.url,
      status: "pending",
      failReason: null,
      groupTitle: null,
      groupType: null,
      source: body.source ?? null,
      usedByAccountPhone: null,
      retryCount: 0,
      retryAfter: null,
      createdAt: new Date(),
      processedAt: null,
    });
    const link = await col.findOne({ _id: result.insertedId });
    res.status(201).json(serializeLink(link));
  } catch (e: any) {
    if (e.code === 11000) { res.status(409).json({ error: "Link already exists" }); return; }
    throw e;
  }
});

router.post("/links/bulk", async (req, res): Promise<void> => {
  let rawUrls: string[] = [];
  const body = req.body as any;

  if (body?.rawText && typeof body.rawText === "string") {
    rawUrls = extractTelegramUrls(body.rawText);
  } else if (Array.isArray(body?.urls)) {
    const allText = body.urls.join("\n");
    rawUrls = extractTelegramUrls(allText);
    if (rawUrls.length === 0) rawUrls = body.urls;
  } else {
    res.status(400).json({ error: "Body must have urls[] or rawText" });
    return;
  }

  const source = body?.source ?? null;
  const col = await collections.targetLinks();
  const joinedCol = await collections.joined();

  let added = 0;
  let duplicates = 0;
  let alreadyJoined = 0;
  let errors = 0;

  const alreadyJoinedUrls: { url: string; accountPhone: string }[] = [];

  for (const url of rawUrls) {
    // Check JOINED collection first
    const joinedDoc = await joinedCol.findOne({ url });
    if (joinedDoc) {
      alreadyJoined++;
      alreadyJoinedUrls.push({ url, accountPhone: joinedDoc.accountPhone });
      continue;
    }

    try {
      await col.insertOne({
        _id: new ObjectId(),
        url,
        status: "pending",
        failReason: null,
        groupTitle: null,
        groupType: null,
        source,
        usedByAccountPhone: null,
        retryCount: 0,
        retryAfter: null,
        createdAt: new Date(),
        processedAt: null,
      });
      added++;
    } catch (e: any) {
      if (e.code === 11000) { duplicates++; } else { errors++; }
    }
  }

  res.status(201).json({
    added,
    duplicates,
    alreadyJoined,
    alreadyJoinedUrls,
    errors,
    total: rawUrls.length,
    extracted: rawUrls.length,
  });
});

router.post("/links/:id/retry", async (req, res): Promise<void> => {
  const id = req.params["id"];
  if (!id || !ObjectId.isValid(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const col = await collections.targetLinks();
  const result = await col.findOneAndUpdate(
    { _id: new ObjectId(id) },
    { $set: { status: "pending", retryAfter: null, failReason: null } },
    { returnDocument: "after" }
  );
  if (!result) { res.status(404).json({ error: "Link not found" }); return; }
  res.json(serializeLink(result));
});

router.delete("/links/:id", async (req, res): Promise<void> => {
  const id = req.params["id"];
  if (!id || !ObjectId.isValid(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const col = await collections.targetLinks();
  const result = await col.deleteOne({ _id: new ObjectId(id) });
  if (result.deletedCount === 0) { res.status(404).json({ error: "Link not found" }); return; }
  res.sendStatus(204);
});

export default router;
