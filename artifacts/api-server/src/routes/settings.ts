/**
 * SETTINGS ROUTE
 *
 * GET  /settings        — list all settings as key-value object
 * PUT  /settings        — update one or more settings
 * GET  /settings/telegram-status — check if Telegram API credentials are configured
 */

import { Router, type IRouter } from "express";
import { getSettings, setSetting } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { invalidateCredentialsCache } from "../lib/clientPool.js";

const router: IRouter = Router();

router.get("/settings", async (_req, res): Promise<void> => {
  const kv = await getSettings();
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(kv)) {
    if (key === "telegram_api_hash" && value) {
      out[key] = value.slice(0, 4) + "****" + value.slice(-4);
    } else {
      out[key] = value;
    }
  }
  res.json(out);
});

router.get("/settings/telegram-status", async (_req, res): Promise<void> => {
  const envApiId = process.env["TELEGRAM_API_ID"];
  const envApiHash = process.env["TELEGRAM_API_HASH"];
  if (envApiId && envApiHash) {
    res.json({ configured: true, source: "env" });
    return;
  }
  const kv = await getSettings();
  res.json({
    configured: !!(kv["telegram_api_id"] && kv["telegram_api_hash"]),
    source: kv["telegram_api_id"] && kv["telegram_api_hash"] ? "database" : "none",
  });
});

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
    "ai_filter_enabled",
    "mongo_backup_url",
    "mongo_backup_db",
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
    await setSetting(update.key, update.value);
  }

  if (updates.some((u) => u.key === "telegram_api_id" || u.key === "telegram_api_hash")) {
    invalidateCredentialsCache();
  }

  logger.info({ keys: updates.map((u) => u.key) }, "Settings updated");
  res.json({ updated: updates.map((u) => u.key) });
});

export default router;
