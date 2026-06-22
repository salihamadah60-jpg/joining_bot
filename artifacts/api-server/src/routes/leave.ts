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
import {
  leaveGroupsBatch,
  autoCleanupAccount,
  addToLeaveQueue,
  getLeaveQueue,
  clearLeaveQueue,
  removeLeaveQueueItem,
} from "../lib/leaveEngine.js";
import type { LeaveTarget } from "../lib/leaveEngine.js";
import { classifyGroupQuick } from "../lib/groupFilter.js";
import { classifyGroupConfidence, classifyByKeywords } from "../lib/keywordSpecialtyClassifier.js";

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
        classification: classifyGroupQuick(d.title, null),
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
        classification: classifyGroupConfidence(d.title, d.url),
      })),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/leave/rejoin — re-add left URLs back to join queue ──────────────
// Server-side medical safety filter: look up title from left_groups and verify
// the group is medical or probably_medical before re-queuing.
router.post("/leave/rejoin", async (req, res): Promise<void> => {
  try {
    const { urls, skipMedicalFilter } = req.body as {
      urls: string[];
      skipMedicalFilter?: boolean; // admin override; default false
    };
    if (!Array.isArray(urls) || urls.length === 0) {
      res.status(400).json({ error: "urls array required" });
      return;
    }

    const targetLinksCol = await collections.targetLinks();
    const leftCol = await collections.leftGroups();

    // Build a title-lookup map from left_groups for the submitted URLs
    const leftDocs = await leftCol
      .find({ url: { $in: urls } }, { projection: { url: 1, title: 1 } })
      .toArray();
    const titleByUrl = new Map<string, string | null>();
    for (const d of leftDocs) titleByUrl.set(d.url, d.title ?? null);

    let added = 0;
    let skipped = 0;
    let filteredOut = 0;

    for (const url of urls) {
      if (!url || typeof url !== "string") continue;

      // ── Medical gate (server-side safety net) ────────────────────────────────
      if (!skipMedicalFilter) {
        const title = titleByUrl.get(url) ?? null;
        const conf = classifyGroupConfidence(title, url);
        if (conf === "non_medical") {
          // Hard non-medical — never re-queue
          filteredOut++;
          continue;
        }
        if (conf === "uncertain") {
          // Uncertain with no specialty keyword — also skip
          const specialty = classifyByKeywords(title, url);
          if (!specialty) {
            filteredOut++;
            continue;
          }
        }
      }

      // Check if URL already exists in the target links collection
      const existing = await targetLinksCol.findOne({ url });

      if (existing) {
        if (existing.status === "pending" || existing.status === "joined") {
          skipped++;
        } else {
          await targetLinksCol.updateOne(
            { url },
            {
              $set: {
                status: "pending",
                failReason: null,
                retryAfter: null,
                processedAt: null,
                retryCount: 0,
                source: "rejoin",
              },
            }
          );
          added++;
        }
      } else {
        try {
          await targetLinksCol.insertOne({
            _id: new ObjectId(),
            url,
            status: "pending",
            failReason: null,
            groupTitle: titleByUrl.get(url) ?? null,
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
          skipped++;
        }
      }
    }

    res.json({ added, skipped, filteredOut });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// LEAVE QUEUE ROUTES — persistent per-account sequential leave queue
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/leave/queue/all — all queues grouped by account (must be before /:phone)
router.get("/leave/queue/all", async (_req, res): Promise<void> => {
  try {
    const qCol = await collections.leaveQueue();
    const items = await qCol.find({ status: { $ne: "done" } }).sort({ addedAt: 1 }).toArray();
    const grouped: Record<string, { pending: number; processing: number; failed: number; items: any[] }> = {};
    for (const item of items) {
      if (!grouped[item.accountPhone]) grouped[item.accountPhone] = { pending: 0, processing: 0, failed: 0, items: [] };
      const g = grouped[item.accountPhone]!;
      if (item.status === "pending") g.pending++;
      else if (item.status === "processing") g.processing++;
      else if (item.status === "failed") g.failed++;
      g.items.push({
        id: item._id.toString(),
        title: item.title,
        chatId: item.chatId,
        url: item.url,
        status: item.status,
        addedAt: new Date(item.addedAt).toISOString(),
        errorMessage: item.errorMessage ?? null,
      });
    }
    res.json(grouped);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// GET /api/leave/queue/:phone — queue for specific account
router.get("/leave/queue/:phone", async (req, res): Promise<void> => {
  try {
    const phone = decodeURIComponent(req.params["phone"]!);
    const items = await getLeaveQueue(phone);
    res.json({
      pending: items.filter((i) => i.status === "pending").length,
      processing: items.filter((i) => i.status === "processing").length,
      done: items.filter((i) => i.status === "done").length,
      failed: items.filter((i) => i.status === "failed").length,
      items: items
        .filter((i) => i.status !== "done")
        .map((i) => ({
          id: i._id.toString(),
          title: i.title,
          chatId: i.chatId,
          url: i.url,
          status: i.status,
          addedAt: new Date(i.addedAt).toISOString(),
          processedAt: i.processedAt ? new Date(i.processedAt).toISOString() : null,
          errorMessage: i.errorMessage ?? null,
        })),
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// POST /api/leave/queue — add items to the leave queue for an account
router.post("/leave/queue", async (req, res): Promise<void> => {
  try {
    const { accountPhone, groups, reason } = req.body as { accountPhone: string; groups: LeaveTarget[]; reason?: string };
    if (!accountPhone) { res.status(400).json({ error: "accountPhone required" }); return; }
    if (!Array.isArray(groups) || groups.length === 0) { res.status(400).json({ error: "groups array required" }); return; }
    const result = await addToLeaveQueue(accountPhone, groups, reason ?? "manual");
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/leave/queue/:phone — clear all pending items for an account
router.delete("/leave/queue/:phone", async (req, res): Promise<void> => {
  try {
    const phone = decodeURIComponent(req.params["phone"]!);
    const deleted = await clearLeaveQueue(phone);
    res.json({ deleted });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/leave/queue/item/:id — remove a single item by _id
router.delete("/leave/queue/item/:id", async (req, res): Promise<void> => {
  try {
    const removed = await removeLeaveQueueItem(req.params["id"]!);
    res.json({ removed });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
