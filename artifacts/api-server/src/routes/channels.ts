import { Router, type IRouter } from "express";
import { collections } from "@workspace/db";
import { classifyByKeywords } from "../lib/keywordSpecialtyClassifier.js";
import { eventBus } from "../lib/eventBus.js";

const router: IRouter = Router();

// ─── GET /api/channels ───────────────────────────────────────────────────────
// Returns all channels with specialty field included.
router.get("/channels", async (req, res): Promise<void> => {
  const col = await collections.channels();
  const { specialty } = req.query as { specialty?: string };

  const filter: Record<string, any> = {};
  if (specialty === "unclassified") {
    filter.$or = [{ specialty: { $exists: false } }, { specialty: null }];
  } else if (specialty === "non_medical") {
    filter.specialty = "non_medical";
  } else if (specialty && specialty !== "all") {
    filter.specialty = specialty;
  }

  const channels = await col.find(filter).sort({ detectedAt: -1 }).toArray();
  res.json(channels.map((c) => ({
    id: c._id.toString(),
    url: c.url,
    title: c.title ?? null,
    specialty: (c as any).specialty ?? null,
    detectedAt: c.detectedAt ? new Date(c.detectedAt).toISOString() : new Date().toISOString(),
  })));
});

// ─── GET /api/channels/stats ─────────────────────────────────────────────────
// Returns count breakdown per specialty.
router.get("/channels/stats", async (req, res): Promise<void> => {
  const col = await collections.channels();
  const pipeline = [
    { $group: { _id: { $ifNull: ["$specialty", null] }, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ];
  const agg = await col.aggregate(pipeline).toArray();
  const stats: Record<string, number> = {};
  for (const row of agg) {
    stats[row._id ?? "unclassified"] = row.count;
  }
  res.json({ stats, total: agg.reduce((s, r) => s + r.count, 0) });
});

// ─── POST /api/channels/classify ─────────────────────────────────────────────
// Classify ALL channels by keyword (instant, no API quota).
// Returns immediately; runs in background; emits SSE events for progress.
router.post("/channels/classify", async (req, res): Promise<void> => {
  res.json({ ok: true, background: true, message: "تصنيف القنوات بدأ في الخلفية" });

  (async () => {
    const col = await collections.channels();
    const channels = await col.find({}).toArray();
    const total = channels.length;

    eventBus.publish({
      type: "channel_classify_start",
      message: `🔑 تصنيف ${total.toLocaleString()} قناة بالكلمات المفتاحية...`,
      total,
      timestamp: new Date().toISOString(),
    });

    const specialtyCounts: Record<string, number> = {};
    let classified = 0;
    let nonMedical = 0;
    const BATCH = 200;

    for (let i = 0; i < channels.length; i += BATCH) {
      const chunk = channels.slice(i, i + BATCH);

      for (const ch of chunk) {
        const specialty = classifyByKeywords(ch.title, ch.url);
        const specValue = specialty ?? "non_medical";
        await col.updateOne({ _id: ch._id }, { $set: { specialty: specValue } } as any);
        if (specialty) {
          classified++;
          specialtyCounts[specialty] = (specialtyCounts[specialty] ?? 0) + 1;
        } else {
          nonMedical++;
        }
      }

      eventBus.publish({
        type: "channel_classify_progress",
        message: `🔄 صُنِّف ${Math.min(i + BATCH, total).toLocaleString()}/${total.toLocaleString()} قناة`,
        classified,
        nonMedical,
        total,
        timestamp: new Date().toISOString(),
      });
    }

    const breakdown = Object.entries(specialtyCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([s, n]) => `${s}: ${n}`)
      .join(" | ");

    eventBus.publish({
      type: "channel_classify_complete",
      message: `✅ اكتمل تصنيف القنوات — طبي: ${classified} | غير طبي: ${nonMedical}${breakdown ? ` | ${breakdown}` : ""}`,
      classified,
      nonMedical,
      total,
      specialtyCounts,
      timestamp: new Date().toISOString(),
    });
  })().catch((err) => {
    eventBus.publish({
      type: "channel_classify_error",
      message: `❌ فشل تصنيف القنوات: ${String(err)}`,
      timestamp: new Date().toISOString(),
    });
  });
});

// ─── DELETE /api/channels/non-medical ────────────────────────────────────────
// Remove all channels marked as non_medical (or unclassified if requested).
// Body: { includeUnclassified?: boolean } — default false (only remove non_medical).
router.delete("/channels/non-medical", async (req, res): Promise<void> => {
  try {
    const { includeUnclassified = false } = (req.body ?? {}) as { includeUnclassified?: boolean };
    const col = await collections.channels();

    const filter: Record<string, any> = { specialty: "non_medical" };
    if (includeUnclassified) {
      filter.$or = [
        { specialty: "non_medical" },
        { specialty: { $exists: false } },
        { specialty: null },
      ];
      delete filter.specialty;
    }

    const result = await col.deleteMany(filter);
    res.json({ ok: true, deleted: result.deletedCount });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── DELETE /api/channels/:id ─────────────────────────────────────────────────
// Delete a single channel by ID.
router.delete("/channels/:id", async (req, res): Promise<void> => {
  try {
    const { ObjectId } = await import("mongodb");
    const col = await collections.channels();
    const result = await col.deleteOne({ _id: new ObjectId(req.params.id) });
    if (result.deletedCount === 0) {
      res.status(404).json({ error: "لم يُوجد القناة" });
      return;
    }
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/channels/export ────────────────────────────────────────────────
// Export channels as plain text. Optionally filter by specialty.
router.get("/channels/export", async (req, res): Promise<void> => {
  const col = await collections.channels();
  const { specialty } = req.query as { specialty?: string };

  const filter: Record<string, any> = {};
  if (specialty && specialty !== "all") {
    if (specialty === "medical") {
      filter.specialty = { $nin: ["non_medical", null], $exists: true };
    } else {
      filter.specialty = specialty;
    }
  }

  const channels = await col.find(filter).sort({ detectedAt: -1 }).toArray();
  const dateStr = new Date().toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" });
  const lines = channels.map(
    (c, i) => `${i + 1}. ${c.title ? `${c.title}  —  ` : ""}${c.url}${(c as any).specialty ? `  [${(c as any).specialty}]` : ""}`
  );

  const content = [
    `قائمة القنوات المكتشفة${specialty ? ` — تخصص: ${specialty}` : ""}`,
    `عدد القنوات: ${channels.length}`,
    `تاريخ التصدير: ${dateStr}`,
    ``,
    ...lines,
  ].join("\n");

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="channels_${Date.now()}.txt"; filename*=UTF-8''channels_${Date.now()}.txt`
  );
  res.send(content);
});

export default router;
