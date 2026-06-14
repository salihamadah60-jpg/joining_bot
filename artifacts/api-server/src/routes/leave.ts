/**
 * LEAVE ROUTES — completely independent from join operations.
 *
 * POST /api/leave/batch            — batch leave multiple groups for one account
 * POST /api/leave/auto-cleanup/:phone — trigger auto-cleanup for channels_limit account
 * GET  /api/leave/history          — list left groups history
 * POST /api/leave/rejoin           — re-add URLs back to join queue
 * GET  /api/accounts/:phone/dialogs — get synced groups for an account (for UI)
 */

import { Router, type IRouter } from "express";
import { ObjectId } from "mongodb";
import { collections } from "@workspace/db";
import { leaveGroupsBatch, autoCleanupAccount } from "../lib/leaveEngine.js";
import type { LeaveTarget } from "../lib/leaveEngine.js";

const router: IRouter = Router();

// ── GET /api/accounts/:phone/dialogs — synced groups for one account ──────────
router.get("/accounts/:phone/dialogs", async (req, res): Promise<void> => {
  try {
    const phone = decodeURIComponent(req.params.phone!);
    const syncedCol = await collections.syncedDialogs();
    const dialogs = await syncedCol
      .find({ accountPhone: phone })
      .sort({ syncedAt: -1 })
      .toArray();
    res.json(
      dialogs.map((d) => ({
        id: d._id.toString(),
        chatId: d.chatId,
        title: d.title ?? null,
        username: d.username ?? null,
        url: d.url ?? null,
        chatType: d.chatType ?? null,
        syncedAt: d.syncedAt ? new Date(d.syncedAt).toISOString() : null,
      }))
    );
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/leave/batch — batch leave groups ────────────────────────────────
router.post("/leave/batch", async (req, res): Promise<void> => {
  try {
    const { accountPhone, groups, reason } = req.body as {
      accountPhone: string;
      groups: LeaveTarget[];
      reason?: string;
    };

    if (!accountPhone) { res.status(400).json({ error: "accountPhone required" }); return; }
    if (!Array.isArray(groups) || groups.length === 0) { res.status(400).json({ error: "groups array required" }); return; }

    const result = await leaveGroupsBatch(accountPhone, groups, reason ?? "manual");
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/leave/auto-cleanup/:phone — trigger cleanup for full account ───
router.post("/leave/auto-cleanup/:phone", async (req, res): Promise<void> => {
  try {
    const phone = decodeURIComponent(req.params.phone!);
    const result = await autoCleanupAccount(phone);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/leave/history — list all left groups ────────────────────────────
router.get("/leave/history", async (req, res): Promise<void> => {
  try {
    const { accountPhone, limit = "100", offset = "0" } = req.query as Record<string, string>;
    const leftCol = await collections.leftGroups();

    const filter: Record<string, any> = {};
    if (accountPhone) filter["accountPhone"] = accountPhone;

    const total = await leftCol.countDocuments(filter);
    const docs = await leftCol
      .find(filter)
      .sort({ leftAt: -1 })
      .skip(Number(offset))
      .limit(Number(limit))
      .toArray();

    res.json({
      total,
      items: docs.map((d) => ({
        id: d._id.toString(),
        url: d.url,
        accountPhone: d.accountPhone,
        title: d.title ?? null,
        chatType: d.chatType ?? null,
        reason: d.reason,
        leftAt: new Date(d.leftAt).toISOString(),
      })),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/leave/rejoin — re-add left URLs back to join queue ──────────────
router.post("/leave/rejoin", async (req, res): Promise<void> => {
  try {
    const { urls } = req.body as { urls: string[] };
    if (!Array.isArray(urls) || urls.length === 0) {
      res.status(400).json({ error: "urls array required" });
      return;
    }

    const targetLinksCol = await collections.targetLinks();
    let added = 0;
    let skipped = 0;

    for (const url of urls) {
      try {
        await targetLinksCol.insertOne({
          _id: new ObjectId(),
          url,
          status: "pending",
          failReason: null,
          groupTitle: null,
          groupType: null,
          source: "rejoin",
          usedByAccountPhone: null,
          retryCount: 0,
          retryAfter: null,
          createdAt: new Date(),
          processedAt: null,
        });
        added++;
      } catch {
        skipped++; // already exists
      }
    }

    res.json({ added, skipped });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
