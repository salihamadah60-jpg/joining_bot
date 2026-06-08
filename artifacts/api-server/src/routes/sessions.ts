/**
 * SESSION BACKUP ROUTES
 * Endpoints to backup / restore / import / list Telegram sessions in MongoDB.
 */

import { Router, type IRouter } from "express";
import {
  backupSessionsToMongo,
  restoreSessionsFromMongo,
  importAccountsFromMongo,
  listMongoSessions,
} from "../lib/mongoSessionBackup.js";

const router: IRouter = Router();

/** POST /api/sessions/backup — backup all sessions to MongoDB */
router.post("/sessions/backup", async (req, res): Promise<void> => {
  try {
    const result = await backupSessionsToMongo();
    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message ?? "فشل النسخ الاحتياطي" });
  }
});

/** POST /api/sessions/restore — restore missing sessions from MongoDB (existing accounts only) */
router.post("/sessions/restore", async (req, res): Promise<void> => {
  try {
    const result = await restoreSessionsFromMongo();
    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message ?? "فشل الاستعادة" });
  }
});

/** POST /api/sessions/import — import ALL accounts from MongoDB into PostgreSQL (creates new accounts) */
router.post("/sessions/import", async (req, res): Promise<void> => {
  try {
    const result = await importAccountsFromMongo();
    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message ?? "فشل الاستيراد" });
  }
});

/** GET /api/sessions/backup — list sessions currently stored in MongoDB */
router.get("/sessions/backup", async (req, res): Promise<void> => {
  try {
    const sessions = await listMongoSessions();
    res.json({ ok: true, sessions });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message ?? "فشل الاتصال بـ MongoDB" });
  }
});

export default router;
