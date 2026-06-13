/**
 * INVITE REQUESTS ROUTES
 *
 * GET  /invite-requests         — list all invite requests (filterable by status)
 * GET  /invite-requests/stats   — count by status
 * POST /invite-requests/check   — trigger manual check cycle
 */

import { Router, type IRouter } from "express";
import { collections } from "@workspace/db";
import { runCheck } from "../lib/inviteRequestChecker.js";

const router: IRouter = Router();

function serialize(doc: any) {
  return {
    id: doc._id.toString(),
    url: doc.url,
    accountPhone: doc.accountPhone,
    status: doc.status,
    groupTitle: doc.groupTitle ?? null,
    sentAt: doc.sentAt ? new Date(doc.sentAt).toISOString() : null,
    approvedAt: doc.approvedAt ? new Date(doc.approvedAt).toISOString() : null,
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
  };
}

router.get("/invite-requests/stats", async (_req, res): Promise<void> => {
  const col = await collections.inviteRequests();
  const [pending, approved, expired] = await Promise.all([
    col.countDocuments({ status: "pending" }),
    col.countDocuments({ status: "approved" }),
    col.countDocuments({ status: "expired" }),
  ]);
  res.json({ pending, approved, expired, total: pending + approved + expired });
});

router.get("/invite-requests", async (req, res): Promise<void> => {
  const col = await collections.inviteRequests();
  const filter: Record<string, any> = {};
  if (req.query["status"]) filter["status"] = req.query["status"];
  if (req.query["phone"]) filter["accountPhone"] = req.query["phone"];
  const docs = await col.find(filter).sort({ sentAt: -1 }).limit(500).toArray();
  res.json(docs.map(serialize));
});

router.post("/invite-requests/check", async (_req, res): Promise<void> => {
  const result = await runCheck();
  res.json({ ok: true, ...result });
});

export default router;
