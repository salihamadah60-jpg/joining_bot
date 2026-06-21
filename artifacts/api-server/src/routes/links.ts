import { Router, type IRouter } from "express";
import { ObjectId } from "mongodb";
import { collections } from "@workspace/db";
import { eventBus } from "../lib/eventBus.js";

const router: IRouter = Router();

/**
 * Normalize a t.me URL by stripping message IDs.
 * https://t.me/channel/12345  →  https://t.me/channel
 * https://t.me/+HASH          →  kept as-is (private invite)
 * https://t.me/joinchat/HASH  →  kept as-is (old private invite)
 */
function normalizeTelegramUrl(url: string): string {
  try {
    let normalized = url.trim();
    if (/^t\.me\//i.test(normalized)) normalized = "https://" + normalized;
    if (!/^https?:\/\//i.test(normalized)) return url;
    const u = new URL(normalized);
    if (!u.hostname.endsWith("t.me")) return url;
    const parts = u.pathname.split("/").filter(Boolean);
    if (!parts.length) return url;
    const first = parts[0]!;
    if (first.startsWith("+")) return `https://t.me/${first}`;
    if (first.toLowerCase() === "joinchat" && parts[1]) return `https://t.me/joinchat/${parts[1]}`;
    return `https://t.me/${first}`;
  } catch {
    return url;
  }
}

/** Extract all valid Telegram URLs from a raw text blob. */
function extractTelegramUrls(rawText: string): string[] {
  const pattern = /(?:https?:\/\/t\.me\/[^\s"'<>\u0600-\u06FF]+|t\.me\/[^\s"'<>\u0600-\u06FF]+|@[a-zA-Z][a-zA-Z0-9_]{3,})/gi;
  const matches = rawText.match(pattern) ?? [];
  const normalised = matches.map((u) => {
    let url = u.trim().replace(/[,;.،؛]+$/, "");
    if (url.startsWith("@")) return `https://t.me/${url.slice(1)}`;
    if (!url.startsWith("http")) return `https://${url}`;
    return normalizeTelegramUrl(url);
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
    const normalizedUrl = normalizeTelegramUrl(body.url.trim());
    const result = await col.insertOne({
      _id: new ObjectId(),
      url: normalizedUrl,
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

// ─── Requeue skipped links (AI-powered full history scan) ────────────────────
// POST /api/links/requeue-skipped
// 1. Immediately resets all "skipped" TARGET_LINKS back to "pending".
// 2. Spawns a background job that reads the FULL join_history, classifies
//    every failed/unknown link title with Gemini, and re-queues any that
//    belong to one of the 8 medical specialties.
router.post("/links/requeue-skipped", async (req, res): Promise<void> => {
  const col = await collections.targetLinks();

  // Step 1 — reset all skipped links instantly (existing behaviour, very fast)
  const skippedResult = await col.updateMany(
    { status: "skipped" },
    { $set: { status: "pending", failReason: null, retryCount: 0, retryAfter: null, processedAt: null } }
  );

  // Respond immediately so the UI doesn't wait for the AI scan
  res.json({
    ok: true,
    immediate: skippedResult.modifiedCount,
    background: true,
    message: `تمت إعادة ${skippedResult.modifiedCount.toLocaleString()} رابط مُتجاهَل فوراً — جارٍ فحص السجل الكامل بالذكاء الاصطناعي في الخلفية...`,
  });

  // Step 2 — background AI scan (fire-and-forget)
  runMedicalRequeueFromHistory().catch((err) => {
    eventBus.publish({
      type: "requeue_error",
      message: `❌ فشل فحص سجل الانضمام: ${String(err)}`,
      timestamp: new Date().toISOString(),
    });
  });
});

/**
 * Background job: scan the full join_history, resolve group titles from
 * TARGET_LINKS / JOINED / left_groups, classify with AI, and re-add any
 * medical link that is not already pending/joined back to the queue.
 */
async function runMedicalRequeueFromHistory(): Promise<void> {
  const { classifySpecialtyBatch } = await import("../lib/aiSpecialtyClassifier.js");
  const { logger } = await import("../lib/logger.js");
  const { ObjectId } = await import("mongodb");

  const targetLinksCol = await collections.targetLinks();
  const joinHistoryCol = await collections.joinHistory();
  const joinedCol     = await collections.joined();
  const leftCol       = await collections.leftGroups();

  // ── Collect all unique URLs from full join history ─────────────────────────
  const historyUrls: string[] = await (joinHistoryCol as any).distinct("linkUrl");

  if (historyUrls.length === 0) {
    eventBus.publish({
      type: "requeue_complete",
      message: "✅ السجل فارغ — لا روابط للفحص",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // ── Fetch current TARGET_LINKS status for all those URLs ──────────────────
  const existingLinks = await targetLinksCol.find(
    { url: { $in: historyUrls } } as any
  ).toArray();

  const existingByUrl = new Map<string, any>();
  for (const l of existingLinks) existingByUrl.set(l.url, l);

  // ── Determine candidates: links that should be re-checked with AI ─────────
  // Include:
  //   • Not in TARGET_LINKS at all (never processed or was deleted)
  //   • status === "failed" with a filter-based reason (not_in_scope,
  //     BLOCKED_PRE:<keyword>, BLOCKED_POST:<keyword>)
  // Exclude channels (CHANNEL_BLOCKED / CHANNEL_BLOCKED_PRE) — intentional block.
  // Exclude already pending / joined / invite_request / pending_review.
  const candidates: Array<{ url: string; title: string | null; existingId: any | null }> = [];

  for (const url of historyUrls) {
    if (!url) continue;
    const existing = existingByUrl.get(url);

    if (!existing) {
      candidates.push({ url, title: null, existingId: null });
      continue;
    }

    if (existing.status === "pending" || existing.status === "joined" ||
        existing.status === "invite_request" || existing.status === "pending_review") {
      continue; // already active — skip
    }

    if (existing.status === "failed") {
      const r = existing.failReason ?? "";
      // Only re-check if the rejection was from a filter, not a hard channel/Telegram error
      const isFilterReject =
        r === "not_in_scope" ||
        r.startsWith("BLOCKED_PRE:") ||
        r.startsWith("BLOCKED_POST:");
      if (isFilterReject) {
        candidates.push({ url, title: existing.groupTitle ?? null, existingId: existing._id });
      }
    }
  }

  if (candidates.length === 0) {
    eventBus.publish({
      type: "requeue_complete",
      message: "✅ فحص السجل اكتمل — لا روابط طبية جديدة تستحق إعادة الإضافة",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // ── Enrich missing titles from JOINED + left_groups ───────────────────────
  const urlsWithoutTitle = candidates.filter((c) => !c.title).map((c) => c.url);
  if (urlsWithoutTitle.length > 0) {
    const joinedDocs = await joinedCol.find({ url: { $in: urlsWithoutTitle } }).toArray();
    const leftDocs   = await (leftCol as any).find({ url: { $in: urlsWithoutTitle } }).toArray();

    const titleByUrl = new Map<string, string>();
    for (const d of joinedDocs) if (d.groupTitle) titleByUrl.set(d.url, d.groupTitle);
    for (const d of leftDocs)   if (d.title)      titleByUrl.set(d.url, d.title);

    for (const c of candidates) {
      if (!c.title && titleByUrl.has(c.url)) c.title = titleByUrl.get(c.url)!;
    }
  }

  // ── AI classification in batches of 20 ────────────────────────────────────
  const BATCH_SIZE  = 20;
  const BATCH_DELAY = 4_000;
  let added      = 0;
  let classified = 0;
  const now = new Date();

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    if (i > 0) await new Promise<void>((r) => setTimeout(r, BATCH_DELAY));

    const chunk     = candidates.slice(i, i + BATCH_SIZE);
    const items     = chunk.map((c) => ({ title: c.title, url: c.url }));
    const specialties = await classifySpecialtyBatch(items);

    for (let j = 0; j < chunk.length; j++) {
      const c         = chunk[j]!;
      const specialty = specialties[j] ?? null;
      classified++;

      if (specialty === null) continue; // Not medical — skip

      if (c.existingId) {
        // Reset the existing failed link back to pending with correct specialty
        await targetLinksCol.updateOne(
          { _id: c.existingId },
          { $set: { status: "pending", failReason: null, retryCount: 0, retryAfter: null, processedAt: null, specialty } } as any
        );
      } else {
        // New entry — insert as pending
        try {
          await targetLinksCol.insertOne({
            _id: new ObjectId(),
            url: c.url,
            status: "pending",
            groupTitle: c.title ?? null,
            specialty,
            source: "requeue_from_history",
            failReason: null,
            retryCount: 0,
            retryAfter: null,
            createdAt: now,
            processedAt: null,
            usedByAccountPhone: null,
            groupType: null,
          } as any);
        } catch (e: any) {
          if (e?.code !== 11000) throw e; // ignore duplicates
        }
      }
      added++;
    }

    eventBus.publish({
      type: "requeue_progress",
      message: `🔄 فحص السجل: ${Math.min(i + BATCH_SIZE, candidates.length).toLocaleString()}/${candidates.length.toLocaleString()} — أُعيد إدراج ${added} رابط طبي`,
      timestamp: new Date().toISOString(),
    });
  }

  logger.info({ classified, added }, "Medical requeue from history complete");
  eventBus.publish({
    type: "requeue_complete",
    message: `✅ اكتمل فحص السجل الكامل: فُحص ${classified.toLocaleString()} رابط — أُعيد إدراج ${added.toLocaleString()} رابط طبي إلى قائمة الانتظار`,
    timestamp: new Date().toISOString(),
  });
}

// ─── AI Batch Specialty Classification ───────────────────────────────────────
// POST /api/links/classify-batch
// Classifies joined + invite_request + synced_dialogs + left_groups + skipped links.
// Returns immediately; runs in background; emits SSE events for progress.
router.post("/links/classify-batch", async (req, res): Promise<void> => {
  res.json({ ok: true, background: true, message: "AI classification started in background" });
  runBatchClassification().catch((err) => {
    eventBus.publish({
      type: "classify_error",
      message: `❌ فشل التصنيف: ${String(err)}`,
      timestamp: new Date().toISOString(),
    });
  });
});

async function runBatchClassification(): Promise<void> {
  const { classifySpecialtyBatched } = await import("../lib/aiSpecialtyClassifier.js");
  const { ensureSpecialtyCollection, incrementSpecialtyCollectionCount } = await import("../lib/specialtyCollections.js");
  const { logger } = await import("../lib/logger.js");

  // ── Source 1: JOINED collection ───────────────────────────────────────────────
  const joinedCol = await collections.joined();
  const joinedLinks = await joinedCol.find({
    groupTitle: { $exists: true, $nin: [null, ""] },
    $or: [{ specialty: { $exists: false } }, { specialty: null }],
  } as any).toArray();

  // ── Source 2: invite_requests collection ─────────────────────────────────────
  const inviteCol = await collections.inviteRequests();
  const inviteLinks = await inviteCol.find({
    groupTitle: { $exists: true, $nin: [null, ""] },
    $or: [{ specialty: { $exists: false } }, { specialty: null }],
  } as any).toArray();

  type SourceType = "joined" | "invite" | "left_group" | "skipped_link";
  const urlMap = new Map<string, { title: string; url: string; source: SourceType; id: any }>();

  for (const l of joinedLinks) {
    urlMap.set(l.url, { title: (l as any).groupTitle, url: l.url, source: "joined", id: l._id });
  }
  for (const l of inviteLinks) {
    if (!urlMap.has(l.url)) {
      urlMap.set(l.url, { title: (l as any).groupTitle, url: l.url, source: "invite", id: l._id });
    }
  }

  // ── Source 3: left_groups — groups we've left ─────────────────────────────────
  const leftCol = await collections.leftGroups();
  const leftRecords = await (leftCol as any).find({
    title: { $exists: true, $nin: [null, ""] },
    $or: [{ specialty: { $exists: false } }, { specialty: null }],
  }).toArray();
  for (const l of leftRecords) {
    if (l.url && !urlMap.has(l.url)) {
      urlMap.set(l.url, { title: l.title, url: l.url, source: "left_group", id: l._id });
    }
  }

  // ── Source 4: TARGET_LINKS skipped with groupTitle ────────────────────────────
  const targetLinksCol = await collections.targetLinks();
  const skippedRecords = await targetLinksCol.find({
    status: "skipped",
    groupTitle: { $exists: true, $nin: [null, ""] },
    $or: [{ specialty: { $exists: false } }, { specialty: null }],
  } as any).toArray();
  for (const s of skippedRecords) {
    if (!urlMap.has(s.url)) {
      urlMap.set(s.url, { title: (s as any).groupTitle, url: s.url, source: "skipped_link", id: s._id });
    }
  }

  const deduped = Array.from(urlMap.values());
  const total = deduped.length;

  const sourceBreakdown = [
    `${joinedLinks.length} منضمّ`,
    `${inviteLinks.length} دعوات`,
    `${leftRecords.length} مغادَر`,
    `${skippedRecords.length} مُتجاهَل`,
  ].join(" + ");

  eventBus.publish({
    type: "classify_start",
    message: `🤖 بدء التصنيف الذكي — ${total.toLocaleString()} مجموعة (${sourceBreakdown})`,
    total,
    classified: 0,
    timestamp: new Date().toISOString(),
  });

  if (total === 0) {
    eventBus.publish({
      type: "classify_complete",
      message: "✅ لا توجد مجموعات تحتاج تصنيفاً — الكل مصنَّف مسبقاً",
      total: 0,
      classified: 0,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const items = deduped.map((l) => ({ title: l.title, url: l.url }));
  let classified = 0;

  const results = await classifySpecialtyBatched(items, (done, _total) => {
    eventBus.publish({
      type: "classify_progress",
      message: `🔄 تم تصنيف ${done.toLocaleString()} من ${_total.toLocaleString()}...`,
      total: _total,
      classified: done,
      timestamp: new Date().toISOString(),
    });
  });

  const specialtyDeltas = new Map<string, number>();

  for (let i = 0; i < deduped.length; i++) {
    const specialty = results[i];
    if (!specialty) continue;

    const { url, source, id } = deduped[i]!;

    // Update the source collection record
    if (source === "joined") {
      await joinedCol.updateOne({ _id: id }, { $set: { specialty } } as any);
    } else if (source === "invite") {
      await inviteCol.updateOne({ _id: id }, { $set: { specialty } } as any);
    } else if (source === "left_group") {
      await (leftCol as any).updateOne({ _id: id }, { $set: { specialty } });
    } else if (source === "skipped_link") {
      await targetLinksCol.updateOne({ _id: id }, { $set: { specialty } } as any);
    }

    // Also sync specialty to TARGET_LINKS by URL (skip virtual tg:// keys)
    if (!url.startsWith("tg://")) {
      await targetLinksCol.updateMany({ url }, { $set: { specialty } } as any);
    }

    specialtyDeltas.set(specialty, (specialtyDeltas.get(specialty) ?? 0) + 1);
    classified++;
  }

  for (const [specialty, delta] of specialtyDeltas) {
    await ensureSpecialtyCollection(specialty);
    await incrementSpecialtyCollectionCount(specialty, delta);
  }

  eventBus.publish({
    type: "classify_complete",
    message: `✅ اكتمل التصنيف — ${classified.toLocaleString()} مجموعة صُنِّفت من أصل ${total.toLocaleString()}`,
    total,
    classified,
    timestamp: new Date().toISOString(),
  });

  logger.info({ total, classified }, "Batch specialty classification complete");
}

// ── POST /api/links/set-specialty — manually assign specialty to a link ─────
// Body: { url: string, specialty: string | null }
router.post("/links/set-specialty", async (req, res): Promise<void> => {
  try {
    const { url, specialty } = req.body as { url?: string; specialty?: string | null };
    if (!url) { res.status(400).json({ error: "url is required" }); return; }

    const VALID = ["general","dentistry","nursing","anesthesia","laboratory","pharmacy","exams","channels_only"];
    if (specialty !== null && specialty !== undefined && !VALID.includes(specialty)) {
      res.status(400).json({ error: `Invalid specialty. Must be one of: ${VALID.join(", ")} or null` });
      return;
    }

    const col = await collections.targetLinks();
    const joinedCol = await collections.joined();

    const newVal = specialty ?? null;
    await col.updateMany({ url }, { $set: { specialty: newVal } } as any);
    await (joinedCol as any).updateMany({ url }, { $set: { specialty: newVal } });

    const { logger } = await import("../lib/logger.js");
    logger.info({ url, specialty: newVal }, "Manual specialty assignment");

    res.json({ ok: true, url, specialty: newVal });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/links/requeue-preview — preview ALL-sources requeue candidates ─
// Shows what would be added back to the pending queue from all historical sources.
router.get("/links/requeue-preview", async (req, res): Promise<void> => {
  try {
    const { specialty } = req.query as { specialty?: string };

    const joinedCol = await collections.joined();
    const leftCol = await collections.leftGroups();
    const targetLinksCol = await collections.targetLinks();

    // Build specialty filter if provided
    const specFilter: Record<string, any> = {};
    if (specialty) specFilter["specialty"] = specialty;

    // Source 1: left_groups — previously left (most important for requeue)
    const leftDocs = await (leftCol as any).find({
      url: { $exists: true, $nin: [null, ""] },
      ...specFilter,
    }).sort({ leftAt: -1 }).toArray();

    // Source 2: JOINED with specialty (so user can see them and re-add)
    const joinedDocs = await (joinedCol as any).find({
      url: { $exists: true, $nin: [null, ""] },
      ...specFilter,
    }).sort({ joinedAt: -1 }).limit(2000).toArray();

    // Source 3: TARGET_LINKS skipped
    const skippedFilter: Record<string, any> = { status: "skipped" };
    if (specialty) skippedFilter["specialty"] = specialty;
    const skippedDocs = await targetLinksCol.find(skippedFilter as any).toArray();

    // Deduplicate by URL — left_groups take priority
    const urlMap = new Map<string, {
      url: string; title: string | null; specialty: string | null; source: string;
    }>();

    for (const d of leftDocs) {
      urlMap.set(d.url, { url: d.url, title: d.title ?? null, specialty: d.specialty ?? null, source: "left_groups" });
    }
    for (const d of joinedDocs) {
      if (!urlMap.has(d.url)) {
        urlMap.set(d.url, { url: d.url, title: d.groupTitle ?? d.title ?? null, specialty: d.specialty ?? null, source: "joined" });
      }
    }
    for (const d of skippedDocs) {
      if (!urlMap.has(d.url)) {
        urlMap.set(d.url, { url: d.url, title: (d as any).groupTitle ?? null, specialty: (d as any).specialty ?? null, source: "skipped" });
      }
    }

    // Exclude URLs already in TARGET_LINKS as pending/joined
    const existingActive = await targetLinksCol.find(
      { status: { $in: ["pending", "joined"] } } as any
    ).project({ url: 1 }).toArray();
    const activeUrls = new Set(existingActive.map((d: any) => d.url));

    const candidates = Array.from(urlMap.values()).filter((c) => !activeUrls.has(c.url));

    res.json({
      total: candidates.length,
      breakdown: {
        left_groups: leftDocs.length,
        joined: joinedDocs.length,
        skipped: skippedDocs.length,
        already_active: activeUrls.size,
      },
      items: candidates.slice(0, 2000),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/links/requeue-all-sources — add ALL-sources candidates to queue
// Body: { urls?: string[], specialty?: string }
// If urls provided, re-adds only those. Otherwise re-adds all preview candidates.
router.post("/links/requeue-all-sources", async (req, res): Promise<void> => {
  try {
    const { urls, specialty } = req.body as { urls?: string[]; specialty?: string };
    const targetLinksCol = await collections.targetLinks();
    const joinedCol = await collections.joined();
    const leftCol = await collections.leftGroups();
    const { logger } = await import("../lib/logger.js");

    let candidates: Array<{ url: string; title: string | null; specialty: string | null }> = [];

    if (urls && urls.length > 0) {
      // Re-add only specified URLs
      for (const url of urls) {
        candidates.push({ url, title: null, specialty: specialty ?? null });
      }
    } else {
      // Get all candidates from preview
      const leftDocs = await (leftCol as any).find({ url: { $exists: true, $nin: [null, ""] } }).toArray();
      const joinedDocs = await (joinedCol as any).find({ url: { $exists: true, $nin: [null, ""] } }).toArray();
      const skippedDocs = await targetLinksCol.find({ status: "skipped" } as any).toArray();

      const urlMap = new Map<string, { url: string; title: string | null; specialty: string | null }>();
      for (const d of leftDocs) {
        urlMap.set(d.url, { url: d.url, title: d.title ?? null, specialty: d.specialty ?? null });
      }
      for (const d of joinedDocs) {
        if (!urlMap.has(d.url)) {
          urlMap.set(d.url, { url: d.url, title: d.groupTitle ?? null, specialty: d.specialty ?? null });
        }
      }
      for (const d of skippedDocs) {
        if (!urlMap.has(d.url)) {
          urlMap.set(d.url, { url: d.url, title: (d as any).groupTitle ?? null, specialty: (d as any).specialty ?? null });
        }
      }

      // Exclude already active
      const existingActive = await targetLinksCol.find({ status: { $in: ["pending", "joined"] } } as any)
        .project({ url: 1 }).toArray();
      const activeUrls = new Set(existingActive.map((d: any) => d.url));
      candidates = Array.from(urlMap.values()).filter((c) => !activeUrls.has(c.url));
    }

    if (candidates.length === 0) {
      res.json({ added: 0, skipped: 0 });
      return;
    }

    let added = 0;
    let skipped = 0;
    const now = new Date();

    for (const c of candidates) {
      const normalized = c.url;
      const existing = await targetLinksCol.findOne({ url: normalized } as any);
      if (existing && (existing.status === "pending" || existing.status === "joined")) {
        skipped++;
        continue;
      }
      if (existing) {
        await targetLinksCol.updateOne(
          { _id: existing._id },
          { $set: { status: "pending", retryCount: 0, retryAfter: null, specialty: c.specialty ?? existing.specialty ?? null } } as any
        );
      } else {
        await targetLinksCol.insertOne({
          url: normalized,
          status: "pending",
          groupTitle: c.title,
          specialty: c.specialty ?? null,
          createdAt: now,
          retryCount: 0,
          retryAfter: null,
          addedBy: "requeue_all_sources",
        } as any);
      }
      added++;
    }

    logger.info({ added, skipped }, "Requeue all sources complete");
    res.json({ added, skipped });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
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
