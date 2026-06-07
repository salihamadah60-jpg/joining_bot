/**
 * SETTINGS ROUTE
 *
 * GET  /settings        — list all settings as key-value object
 * PUT  /settings        — update one or more settings
 * GET  /settings/telegram-status — check if Telegram API credentials are configured
 */

import { Router, type IRouter } from "express";
import { db, settingsTable } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { invalidateCredentialsCache } from "../lib/clientPool.js";

const router: IRouter = Router();

// GET /settings — return all settings as flat key→value object
router.get("/settings", async (_req, res): Promise<void> => {
  const rows = await db.select().from(settingsTable);
  const out: Record<string, string> = {};
  for (const r of rows) {
    // Never expose the raw values of sensitive keys — mask them
    if (r.key === "telegram_api_hash" && r.value) {
      out[r.key] = r.value.slice(0, 4) + "****" + r.value.slice(-4);
    } else {
      out[r.key] = r.value;
    }
  }
  res.json(out);
});

// GET /settings/telegram-status — check credential availability
router.get("/settings/telegram-status", async (_req, res): Promise<void> => {
  const envApiId = process.env["TELEGRAM_API_ID"];
  const envApiHash = process.env["TELEGRAM_API_HASH"];

  if (envApiId && envApiHash) {
    res.json({ configured: true, source: "env" });
    return;
  }

  const rows = await db.select().from(settingsTable);
  const kv: Record<string, string> = {};
  for (const r of rows) kv[r.key] = r.value;

  const dbApiId = kv["telegram_api_id"];
  const dbApiHash = kv["telegram_api_hash"];

  res.json({
    configured: !!(dbApiId && dbApiHash),
    source: dbApiId && dbApiHash ? "database" : "none",
  });
});

// PUT /settings — upsert one or more settings
router.put("/settings", async (req, res): Promise<void> => {
  const body = req.body as Record<string, string>;
  if (!body || typeof body !== "object") {
    res.status(400).json({ error: "Body must be a JSON object of key→value pairs" });
    return;
  }

  const ALLOWED_KEYS = new Set([
    "telegram_api_id",
    "telegram_api_hash",
    "auto_sync_interval_minutes",
    "active_start_hour",
  ]);

  const updates: { key: string; value: string }[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (!ALLOWED_KEYS.has(key)) continue;
    if (typeof value !== "string") continue;
    updates.push({ key, value: value.trim() });
  }

  if (updates.length === 0) {
    res.status(400).json({ error: "No valid settings keys provided" });
    return;
  }

  for (const update of updates) {
    await db
      .insert(settingsTable)
      .values({ key: update.key, value: update.value })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value: update.value } });
  }

  // If Telegram credentials were updated, invalidate the cache so next request re-reads them
  if (updates.some((u) => u.key === "telegram_api_id" || u.key === "telegram_api_hash")) {
    invalidateCredentialsCache();
  }

  logger.info({ keys: updates.map((u) => u.key) }, "Settings updated");
  res.json({ updated: updates.map((u) => u.key) });
});

export default router;
