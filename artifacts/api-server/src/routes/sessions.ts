/**
 * SESSION BACKUP ROUTES — P3-3
 * Endpoints to backup / restore / list Telegram sessions in MongoDB.
 */

import { Router, type IRouter } from "express";
import {
  backupSessionsToMongo,
  restoreSessionsFromMongo,
  listMongoSessions,
} from "../lib/mongoSessionBackup.js";

const router: IRouter = Router();

/** POST /api/sessions/backup — trigger manual backup to MongoDB */
router.post("/sessions/backup", async (req, res): Promise<void> => {
  try {
    const result = await backupSessionsToMongo();
    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message ?? "فشل النسخ الاحتياطي" });
  }
});

/** POST /api/sessions/restore — restore missing sessions from MongoDB */
router.post("/sessions/restore", async (req, res): Promise<void> => {
  try {
    const result = await restoreSessionsFromMongo();
    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message ?? "فشل الاستعادة" });
  }
});

/** GET /api/sessions/backup — list sessions currently stored in MongoDB backup */
router.get("/sessions/backup", async (req, res): Promise<void> => {
  try {
    const sessions = await listMongoSessions();
    res.json({ ok: true, sessions });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message ?? "فشل الاتصال بـ MongoDB" });
  }
});

export default router;
