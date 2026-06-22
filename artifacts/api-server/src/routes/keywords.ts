/**
 * KEYWORDS MANAGER API
 *
 * CRUD for user-managed custom keywords stored in MongoDB.
 * These supplement the static medicalKeywords.ts and are refreshed
 * every 60 seconds in the classifier.
 *
 * GET    /api/keywords         — list all custom keywords
 * POST   /api/keywords         — add a new keyword
 * DELETE /api/keywords/:id     — remove a keyword
 */

import { Router } from "express";
import { ObjectId } from "mongodb";
import { collections } from "@workspace/db";
import { refreshCustomKeywords } from "../lib/medicalKeywords.js";

const router = Router();

// ── List all custom keywords ──────────────────────────────────────────────────
router.get("/keywords", async (_req, res): Promise<void> => {
  const col = await collections.customKeywords();
  const docs = await col.find({}).sort({ category: 1, keyword: 1 }).toArray();
  res.json(docs);
});

// ── Add a custom keyword ──────────────────────────────────────────────────────
router.post("/keywords", async (req, res): Promise<void> => {
  const { keyword, category } = req.body ?? {};

  if (!keyword || typeof keyword !== "string" || keyword.trim().length === 0) {
    res.status(400).json({ error: "keyword مطلوب" });
    return;
  }

  const validCategories = ["strong_medical", "hard_blocked", "soft_medical", "not_medical"];
  if (!category || !validCategories.includes(category)) {
    res.status(400).json({ error: `category يجب أن يكون أحد: ${validCategories.join(", ")}` });
    return;
  }

  try {
    const col = await collections.customKeywords();
    await col.insertOne({
      _id: new ObjectId(),
      keyword: keyword.trim().toLowerCase(),
      category,
      addedAt: new Date(),
    });
    await refreshCustomKeywords();
    res.json({ ok: true });
  } catch (e: any) {
    if (e?.code === 11000) {
      res.status(409).json({ error: "هذه الكلمة موجودة بالفعل" });
    } else {
      throw e;
    }
  }
});

// ── Delete a custom keyword ───────────────────────────────────────────────────
router.delete("/keywords/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) {
    res.status(400).json({ error: "معرف غير صالح" });
    return;
  }
  const col = await collections.customKeywords();
  const result = await col.deleteOne({ _id: new ObjectId(id) });
  if (result.deletedCount === 0) {
    res.status(404).json({ error: "الكلمة غير موجودة" });
    return;
  }
  await refreshCustomKeywords();
  res.json({ ok: true });
});

export default router;
