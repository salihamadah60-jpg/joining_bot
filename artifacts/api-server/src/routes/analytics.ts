/**
 * ANALYTICS ROUTE — MongoDB aggregation
 */

import { Router, type IRouter } from "express";
import { collections } from "@workspace/db";

const router: IRouter = Router();

router.get("/analytics/daily", async (req, res): Promise<void> => {
  const days = Math.min(Number(req.query["days"] ?? 14), 60);
  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);

  const col = await collections.activityLog();
  const agg = await col.aggregate([
    {
      $match: {
        createdAt: { $gte: since },
        type: { $in: ["join_success", "join_failed", "flood_wait"] },
      },
    },
    {
      $group: {
        _id: {
          day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          type: "$type",
        },
        count: { $sum: 1 },
      },
    },
  ]).toArray();

  const map: Record<string, { date: string; success: number; failed: number; flood: number }> = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    map[key] = { date: key, success: 0, failed: 0, flood: 0 };
  }

  for (const row of agg) {
    const key = (row._id as any).day as string;
    const type = (row._id as any).type as string;
    if (!map[key]) map[key] = { date: key, success: 0, failed: 0, flood: 0 };
    if (type === "join_success") map[key].success = Number(row.count);
    if (type === "join_failed") map[key].failed = Number(row.count);
    if (type === "flood_wait") map[key].flood = Number(row.count);
  }

  res.json(Object.values(map));
});

router.get("/analytics/errors", async (req, res): Promise<void> => {
  const since = new Date();
  since.setDate(since.getDate() - 30);

  const col = await collections.activityLog();
  const agg = await col.aggregate([
    { $match: { type: "join_failed", createdAt: { $gte: since } } },
    {
      $group: {
        _id: { $ifNull: ["$errorCode", "UNKNOWN"] },
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
    { $limit: 12 },
  ]).toArray();

  res.json(agg.map((r) => ({ code: r._id, count: Number(r.count) })));
});

router.get("/analytics/accounts", async (req, res): Promise<void> => {
  const col = await collections.accounts();
  const accounts = await col.find({}).sort({ joinedCount: 1 }).toArray();
  res.json(accounts.map((a) => ({
    phone: a.phone.slice(-6),
    label: a.label ?? a.phone.slice(-6),
    status: a.status,
    joinedCount: a.joinedCount ?? 0,
    failedCount: a.failedCount ?? 0,
    joinedToday: a.joinedToday ?? 0,
    channelsCount: a.channelsCount ?? 0,
    successRate:
      (a.joinedCount ?? 0) + (a.failedCount ?? 0) > 0
        ? Math.round(((a.joinedCount ?? 0) / ((a.joinedCount ?? 0) + (a.failedCount ?? 0))) * 100)
        : 100,
  })));
});

router.get("/analytics/summary", async (req, res): Promise<void> => {
  const accountsCol = await collections.accounts();
  const accounts = await accountsCol.find({}).toArray();

  const totalJoined = accounts.reduce((s, a) => s + (a.joinedCount ?? 0), 0);
  const totalFailed = accounts.reduce((s, a) => s + (a.failedCount ?? 0), 0);
  const joinedToday = accounts.reduce((s, a) => s + (a.joinedToday ?? 0), 0);

  const linksCol = await collections.targetLinks();
  const pendingLinks = await linksCol.countDocuments({ status: "pending" });
  const joinedLinks = await linksCol.countDocuments({ status: "joined" });
  const failedLinks = await linksCol.countDocuments({ status: "failed" });

  const since24h = new Date(Date.now() - 24 * 3_600_000);
  const activityCol = await collections.activityLog();
  const floodWait24h = await activityCol.countDocuments({ type: "flood_wait", createdAt: { $gte: since24h } });

  res.json({
    totalJoined,
    totalFailed,
    joinedToday,
    successRate:
      totalJoined + totalFailed > 0
        ? Math.round((totalJoined / (totalJoined + totalFailed)) * 100)
        : 100,
    activeAccounts: accounts.filter((a) => a.status === "active").length,
    totalAccounts: accounts.length,
    pendingLinks,
    joinedLinks,
    failedLinks,
    floodWait24h,
  });
});

export default router;
