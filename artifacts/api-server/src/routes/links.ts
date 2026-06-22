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
  // Respond immediately — the full history scan runs in the background.
  // We do NOT blindly reset all "skipped" links here, because that would
  // re-add recently-skipped non-medical groups back to the queue.
  // Instead, runMedicalRequeueFromHistory() reads the FULL join history and
  // re-adds ONLY groups that pass the medical keyword classifier.
  res.json({
    ok: true,
    background: true,
    message: "جاري فحص السجل الكامل — سيتم إعادة الروابط الطبية فقط إلى قائمة الانتظار...",
  });

  runMedicalRequeueFromHistory().catch((err) => {
    eventBus.publish({
      type: "requeue_error",
      message: `❌ فشل فحص سجل الانضمام: ${String(err)}`,
      timestamp: new Date().toISOString(),
    });
  });
});

/**
 * Background job: scan the full join_history + all sources, resolve group titles,
 * classify with keyword classifier (primary) + AI (fallback), and re-add any
 * medical link that is not already pending/joined back to the queue.
 */
async function runMedicalRequeueFromHistory(): Promise<void> {
  const { classifyByKeywords } = await import("../lib/keywordSpecialtyClassifier.js");
  const { logger } = await import("../lib/logger.js");
  const { ObjectId } = await import("mongodb");

  const targetLinksCol = await collections.targetLinks();
  const joinHistoryCol = await collections.joinHistory();
  const joinedCol      = await collections.joined();
  const leftCol        = await collections.leftGroups();

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

  eventBus.publish({
    type: "requeue_progress",
    message: `🔍 وُجد ${historyUrls.length.toLocaleString()} رابط فريد في السجل — جاري تحليلها...`,
    timestamp: new Date().toISOString(),
  });

  // ── Build title lookup from ALL sources ────────────────────────────────────
  // JOINED: groupTitle field
  // left_groups: title field
  // TARGET_LINKS: groupTitle field
  const titleByUrl = new Map<string, string>();

  const [joinedDocs, leftDocs, targetDocs] = await Promise.all([
    joinedCol.find({ url: { $in: historyUrls }, groupTitle: { $exists: true, $nin: [null, ""] } } as any).toArray(),
    (leftCol as any).find({ url: { $in: historyUrls }, title: { $exists: true, $nin: [null, ""] } }).toArray(),
    targetLinksCol.find({ url: { $in: historyUrls }, groupTitle: { $exists: true, $nin: [null, ""] } } as any).toArray(),
  ]);

  for (const d of targetDocs) if ((d as any).groupTitle) titleByUrl.set(d.url, (d as any).groupTitle);
  for (const d of joinedDocs)  if ((d as any).groupTitle) titleByUrl.set(d.url, (d as any).groupTitle);
  for (const d of leftDocs)    if (d.title)               titleByUrl.set(d.url, d.title);

  // ── Fetch current TARGET_LINKS status for all those URLs ──────────────────
  const existingLinks = await targetLinksCol.find({ url: { $in: historyUrls } } as any).toArray();
  const existingByUrl = new Map<string, any>();
  for (const l of existingLinks) existingByUrl.set(l.url, l);

  // URLs that are already in JOINED collection — no need to re-add
  const joinedUrls = new Set(joinedDocs.map((d) => d.url));

  // ── Determine candidates ───────────────────────────────────────────────────
  // Include:
  //   • Not in TARGET_LINKS + not in JOINED → likely historic, may be medical
  //   • status "failed" with filter-based reason: not_in_scope / BLOCKED_PRE / BLOCKED_POST
  //   • status "skipped" → re-check with keyword classifier
  // Exclude: active (pending/joined/invite_request/pending_review)
  // Exclude: channels (CHANNEL_BLOCKED / CHANNEL_BLOCKED_PRE) — intentional block
  const candidates: Array<{ url: string; title: string | null; existingId: any | null }> = [];

  for (const url of historyUrls) {
    if (!url) continue;
    const existing = existingByUrl.get(url);

    if (!existing) {
      // Not in TARGET_LINKS at all
      if (joinedUrls.has(url)) continue; // already joined → skip
      candidates.push({ url, title: titleByUrl.get(url) ?? null, existingId: null });
      continue;
    }

    const status = existing.status as string;

    // Already active → skip
    if (status === "pending" || status === "joined" ||
        status === "invite_request" || status === "pending_review") continue;

    if (status === "failed") {
      const r = (existing.failReason ?? "") as string;
      // Hard channel block → skip (intentional, not a filter mistake)
      if (r === "CHANNEL_BLOCKED" || r === "CHANNEL_BLOCKED_PRE") continue;
      // Filter-based rejection → re-check with keyword classifier
      const isFilterReject = r === "not_in_scope" || r.startsWith("BLOCKED_PRE:") || r.startsWith("BLOCKED_POST:");
      if (isFilterReject) {
        candidates.push({ url, title: titleByUrl.get(url) ?? existing.groupTitle ?? null, existingId: existing._id });
      }
      // Other Telegram errors (FLOOD_WAIT, USER_BANNED, etc.) → leave for engine to retry
    } else if (status === "skipped") {
      candidates.push({ url, title: titleByUrl.get(url) ?? existing.groupTitle ?? null, existingId: existing._id });
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

  eventBus.publish({
    type: "requeue_progress",
    message: `🔑 تصنيف ${candidates.length.toLocaleString()} مرشح بالكلمات المفتاحية (فوري، بدون AI)...`,
    timestamp: new Date().toISOString(),
  });

  // ── Keyword classification (instant, zero API calls) ──────────────────────
  let added = 0;
  const now = new Date();
  const REPORT_EVERY = 500;

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    const specialty = classifyByKeywords(c.title, c.url);

    if (specialty === null) continue; // Not medical

    if (c.existingId) {
      await targetLinksCol.updateOne(
        { _id: c.existingId },
        { $set: { status: "pending", failReason: null, retryCount: 0, retryAfter: null, processedAt: null, specialty } } as any
      );
    } else {
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

    if ((i + 1) % REPORT_EVERY === 0 || i === candidates.length - 1) {
      eventBus.publish({
        type: "requeue_progress",
        message: `🔄 فُحص ${(i + 1).toLocaleString()}/${candidates.length.toLocaleString()} — أُعيد إدراج ${added.toLocaleString()} رابط طبي`,
        timestamp: new Date().toISOString(),
      });
    }
  }

  logger.info({ total: candidates.length, added }, "Medical requeue from history complete");
  eventBus.publish({
    type: "requeue_complete",
    message: `✅ اكتمل فحص السجل: فُحص ${candidates.length.toLocaleString()} مرشح — أُعيد إدراج ${added.toLocaleString()} رابط طبي إلى قائمة الانتظار`,
    timestamp: new Date().toISOString(),
  });
}

// ─── Keyword + AI Batch Specialty Classification ─────────────────────────────
// POST /api/links/classify-batch
// Classifies joined + invite_request + synced_dialogs + left_groups + skipped links.
// Returns immediately; runs in background; emits SSE events for progress.
// PRIMARY: keyword classifier (instant, no quota). AI used only for remainder.
router.post("/links/classify-batch", async (req, res): Promise<void> => {
  res.json({ ok: true, background: true, message: "تصنيف المجموعات بدأ في الخلفية" });
  runBatchClassification().catch((err) => {
    eventBus.publish({
      type: "classify_error",
      message: `❌ فشل التصنيف: ${String(err)}`,
      timestamp: new Date().toISOString(),
    });
  });
});

async function runBatchClassification(): Promise<void> {
  const { classifyBatchByKeywords } = await import("../lib/keywordSpecialtyClassifier.js");
  const { classifySpecialtyBatch } = await import("../lib/aiSpecialtyClassifier.js");
  const { ensureSpecialtyCollection, incrementSpecialtyCollectionCount } = await import("../lib/specialtyCollections.js");
  const { logger } = await import("../lib/logger.js");

  type SourceType = "joined" | "invite" | "left_group" | "skipped_link" | "synced_dialog";
  const urlMap = new Map<string, { title: string; url: string; source: SourceType; id: any }>();

  // ── Source 1: JOINED collection ──────────────────────────────────────────────
  const joinedCol = await collections.joined();
  const joinedLinks = await joinedCol.find({
    groupTitle: { $exists: true, $nin: [null, ""] },
    $or: [{ specialty: { $exists: false } }, { specialty: null }],
  } as any).toArray();
  for (const l of joinedLinks) {
    urlMap.set(l.url, { title: (l as any).groupTitle, url: l.url, source: "joined", id: l._id });
  }

  // ── Source 2: invite_requests collection ─────────────────────────────────────
  const inviteCol = await collections.inviteRequests();
  const inviteLinks = await inviteCol.find({
    groupTitle: { $exists: true, $nin: [null, ""] },
    $or: [{ specialty: { $exists: false } }, { specialty: null }],
  } as any).toArray();
  for (const l of inviteLinks) {
    if (!urlMap.has(l.url)) {
      urlMap.set(l.url, { title: (l as any).groupTitle, url: l.url, source: "invite", id: l._id });
    }
  }

  // ── Source 3: left_groups ─────────────────────────────────────────────────────
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

  // ── Source 5: synced_dialogs (account dialogs synced from all accounts) ───────
  const syncedCol = await collections.syncedDialogs();
  const syncedDialogs = await (syncedCol as any).find({
    title: { $exists: true, $nin: [null, ""] },
    url: { $exists: true, $nin: [null, ""] },
    $or: [{ specialty: { $exists: false } }, { specialty: null }],
  }).toArray();
  for (const d of syncedDialogs) {
    if (d.url && !urlMap.has(d.url)) {
      urlMap.set(d.url, { title: d.title, url: d.url, source: "synced_dialog", id: d._id });
    }
  }

  const deduped = Array.from(urlMap.values());
  const total = deduped.length;

  const sourceBreakdown = [
    `${joinedLinks.length} منضمّ`,
    `${inviteLinks.length} دعوات`,
    `${leftRecords.length} مغادَر`,
    `${skippedRecords.length} مُتجاهَل`,
    `${syncedDialogs.length} مزامنة`,
  ].join(" + ");

  eventBus.publish({
    type: "classify_start",
    message: `🔑 بدء التصنيف بالكلمات المفتاحية — ${total.toLocaleString()} مجموعة (${sourceBreakdown})`,
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

  // ── Step 1: keyword classification (instant, no API calls) ───────────────────
  const keywordResults = classifyBatchByKeywords(items);
  let keywordCount = keywordResults.filter(r => r !== null).length;

  // ── Step 2: for items keywords couldn't classify, try AI in small batches ────
  const needsAI: number[] = [];
  for (let i = 0; i < keywordResults.length; i++) {
    if (keywordResults[i] === null) needsAI.push(i);
  }

  const results = [...keywordResults];
  const AI_BATCH = 20;

  if (needsAI.length > 0) {
    eventBus.publish({
      type: "classify_progress",
      message: `🔑 الكلمات المفتاحية: ${keywordCount.toLocaleString()} مصنَّف — 🤖 الذكاء الاصطناعي يفحص ${needsAI.length.toLocaleString()} باقي...`,
      total,
      classified: keywordCount,
      timestamp: new Date().toISOString(),
    });

    for (let batch = 0; batch < needsAI.length; batch += AI_BATCH) {
      if (batch > 0) await new Promise<void>((r) => setTimeout(r, 4_000));
      const batchIndices = needsAI.slice(batch, batch + AI_BATCH);
      const batchItems = batchIndices.map(i => items[i]!);
      try {
        const aiResults = await classifySpecialtyBatch(batchItems);
        for (let j = 0; j < batchIndices.length; j++) {
          if (aiResults[j] !== null) results[batchIndices[j]!] = aiResults[j]!;
        }
      } catch {
        // AI failed for this batch — skip, keyword results stand
      }
    }
  }

  // ── Step 3: persist results ───────────────────────────────────────────────────
  const specialtyDeltas = new Map<string, number>();
  let classified = 0;

  for (let i = 0; i < deduped.length; i++) {
    const specialty = results[i];
    if (!specialty) continue;

    const { url, source, id } = deduped[i]!;

    if (source === "joined") {
      await joinedCol.updateOne({ _id: id }, { $set: { specialty } } as any);
    } else if (source === "invite") {
      await inviteCol.updateOne({ _id: id }, { $set: { specialty } } as any);
    } else if (source === "left_group") {
      await (leftCol as any).updateOne({ _id: id }, { $set: { specialty } });
    } else if (source === "skipped_link") {
      await targetLinksCol.updateOne({ _id: id }, { $set: { specialty } } as any);
    } else if (source === "synced_dialog") {
      await (syncedCol as any).updateOne({ _id: id }, { $set: { specialty } });
    }

    // Sync specialty to TARGET_LINKS by URL (skip virtual tg:// invite hashes)
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
    message: `✅ اكتمل التصنيف — ${classified.toLocaleString()} مجموعة صُنِّفت من أصل ${total.toLocaleString()} (كلمات مفتاحية: ${keywordCount.toLocaleString()})`,
    total,
    classified,
    timestamp: new Date().toISOString(),
  });

  logger.info({ total, classified, keywordCount }, "Batch specialty classification complete");
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
