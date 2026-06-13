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
    pendingReview: links.filter((l) => l.status === "pending_review").length,
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

/** Approve a pending_review link: mark as pending so bot joins + learn pattern */
router.post("/links/:id/approve", async (req, res): Promise<void> => {
  const id = req.params["id"];
  if (!id || !ObjectId.isValid(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const col = await collections.targetLinks();
  const link = await col.findOne({ _id: new ObjectId(id) });
  if (!link) { res.status(404).json({ error: "Link not found" }); return; }

  // Already joined (pending_review means we joined but weren't sure) → confirm as joined
  await col.updateOne(
    { _id: new ObjectId(id) },
    { $set: { status: "joined", failReason: null, processedAt: new Date() } }
  );

  // Learn from this decision
  if (link.groupTitle) {
    await saveLearnedPattern(link.groupTitle, "relevant");
  }

  res.json({ ok: true, status: "joined" });
});

/** Reject a pending_review link: mark as skipped + learn pattern */
router.post("/links/:id/reject", async (req, res): Promise<void> => {
  const id = req.params["id"];
  if (!id || !ObjectId.isValid(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const col = await collections.targetLinks();
  const link = await col.findOne({ _id: new ObjectId(id) });
  if (!link) { res.status(404).json({ error: "Link not found" }); return; }

  await col.updateOne(
    { _id: new ObjectId(id) },
    { $set: { status: "skipped", failReason: "user_rejected", processedAt: new Date() } }
  );

  // Learn from this decision
  if (link.groupTitle) {
    await saveLearnedPattern(link.groupTitle, "not_relevant");
  }

  res.json({ ok: true, status: "skipped" });
});

/** Save a learned pattern for future auto-classification */
async function saveLearnedPattern(groupTitle: string, decision: "relevant" | "not_relevant"): Promise<void> {
  try {
    const col = await collections.learnedPatterns();
    // Extract keywords from title (words > 3 chars)
    const keywords = groupTitle
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3 && /[a-z\u0600-\u06ff]/i.test(w));

    if (keywords.length === 0) return;

    // Upsert by title
    await col.updateOne(
      { groupTitle: groupTitle.toLowerCase() },
      {
        $set: {
          groupTitle: groupTitle.toLowerCase(),
          decision,
          keywords,
          updatedAt: new Date(),
        },
        $setOnInsert: { _id: new ObjectId(), createdAt: new Date() },
      },
      { upsert: true }
    );
  } catch (e) {
    // Collection might not exist yet — ignore
  }
}

/**
 * POST /links/reuse-joined
 * Re-adds links from JOINED collection back to TARGET_LINKS as "pending"
 * so new accounts can process them. Already-pending links are skipped.
 * Links with other statuses (joined/failed/skipped) are reset to pending.
 */
router.post("/links/reuse-joined", async (req, res): Promise<void> => {
  const joinedCol = await collections.joined();
  const targetCol = await collections.targetLinks();

  const joined = await joinedCol.find({}).toArray();

  let added = 0;
  let reset = 0;
  let skipped = 0;

  for (const j of joined) {
    const existing = await targetCol.findOne({ url: j.url });
    if (existing) {
      if (existing.status === "pending") {
        skipped++;
      } else {
        await targetCol.updateOne(
          { _id: existing._id },
          {
            $set: {
              status: "pending",
              usedByAccountPhone: null,
              failReason: null,
              processedAt: null,
              retryCount: 0,
              retryAfter: null,
              updatedAt: new Date(),
            },
          }
        );
        reset++;
      }
    } else {
      try {
        await targetCol.insertOne({
          _id: new ObjectId(),
          url: j.url,
          status: "pending",
          failReason: null,
          groupTitle: j.groupTitle,
          groupType: j.groupType,
          source: "reuse_joined",
          usedByAccountPhone: null,
          retryCount: 0,
          retryAfter: null,
          createdAt: new Date(),
          processedAt: null,
        });
        added++;
      } catch (e: any) {
        if (e.code !== 11000) throw e;
        skipped++;
      }
    }
  }

  res.json({ added, reset, skipped, total: joined.length });
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
