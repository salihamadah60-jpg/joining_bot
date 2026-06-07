/**
 * ANALYTICS ROUTE — P3-2
 * Provides aggregated statistics for charts and KPIs in the dashboard.
 */

import { Router, type IRouter } from "express";
import { sql, and, gte, eq } from "drizzle-orm";
import { db, activityLogTable, accountsTable, groupLinksTable } from "@workspace/db";

const router: IRouter = Router();

/**
 * GET /api/analytics/daily
 * Returns join_success and join_failed counts per day for the last N days.
 */
router.get("/analytics/daily", async (req, res): Promise<void> => {
  const days = Math.min(Number(req.query["days"] ?? 14), 60);
  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);

  // Group activity_log by date and type
  const rows = await db.execute(sql`
    SELECT
      DATE(created_at AT TIME ZONE 'UTC') AS day,
      type,
      COUNT(*)::int AS count
    FROM activity_log
    WHERE created_at >= ${since}
      AND type IN ('join_success', 'join_failed', 'flood_wait')
    GROUP BY day, type
    ORDER BY day ASC
  `);

  // Build a map day -> { success, failed, flood }
  const map: Record<string, { date: string; success: number; failed: number; flood: number }> = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    map[key] = { date: key, success: 0, failed: 0, flood: 0 };
  }

  for (const row of rows.rows as any[]) {
    const key = String(row.day).slice(0, 10);
    if (!map[key]) map[key] = { date: key, success: 0, failed: 0, flood: 0 };
    if (row.type === "join_success") map[key].success = Number(row.count);
    if (row.type === "join_failed") map[key].failed = Number(row.count);
    if (row.type === "flood_wait") map[key].flood = Number(row.count);
  }

  res.json(Object.values(map));
});

/**
 * GET /api/analytics/errors
 * Returns count of each error code from join_failed events.
 */
router.get("/analytics/errors", async (req, res): Promise<void> => {
  const since = new Date();
  since.setDate(since.getDate() - 30);

  const rows = await db.execute(sql`
    SELECT
      COALESCE(error_code, 'UNKNOWN') AS error_code,
      COUNT(*)::int AS count
    FROM activity_log
    WHERE type = 'join_failed'
      AND created_at >= ${since}
    GROUP BY error_code
    ORDER BY count DESC
    LIMIT 12
  `);

  res.json(
    (rows.rows as any[]).map((r) => ({
      code: r.error_code,
      count: Number(r.count),
    }))
  );
});

/**
 * GET /api/analytics/accounts
 * Returns per-account performance summary.
 */
router.get("/analytics/accounts", async (req, res): Promise<void> => {
  const accounts = await db.select().from(accountsTable).orderBy(accountsTable.joinedCount);

  res.json(
    accounts.map((a) => ({
      phone: a.phone.slice(-6), // last 6 digits for privacy
      label: a.label ?? a.phone.slice(-6),
      status: a.status,
      joinedCount: a.joinedCount,
      failedCount: a.failedCount,
      joinedToday: a.joinedToday,
      channelsCount: a.channelsCount,
      successRate:
        a.joinedCount + a.failedCount > 0
          ? Math.round((a.joinedCount / (a.joinedCount + a.failedCount)) * 100)
          : 100,
    }))
  );
});

/**
 * GET /api/analytics/summary
 * Returns high-level summary KPIs.
 */
router.get("/analytics/summary", async (req, res): Promise<void> => {
  const accounts = await db.select().from(accountsTable);

  const totalJoined = accounts.reduce((s, a) => s + a.joinedCount, 0);
  const totalFailed = accounts.reduce((s, a) => s + a.failedCount, 0);
  const joinedToday = accounts.reduce((s, a) => s + a.joinedToday, 0);

  const pendingLinks = await db.execute(
    sql`SELECT COUNT(*)::int AS count FROM group_links WHERE status = 'pending'`
  );
  const joinedLinks = await db.execute(
    sql`SELECT COUNT(*)::int AS count FROM group_links WHERE status = 'joined'`
  );
  const failedLinks = await db.execute(
    sql`SELECT COUNT(*)::int AS count FROM group_links WHERE status = 'failed'`
  );

  const floodWaitRows = await db.execute(sql`
    SELECT COUNT(*)::int AS count FROM activity_log
    WHERE type = 'flood_wait'
      AND created_at >= NOW() - INTERVAL '24 hours'
  `);

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
    pendingLinks: Number((pendingLinks.rows[0] as any)?.count ?? 0),
    joinedLinks: Number((joinedLinks.rows[0] as any)?.count ?? 0),
    failedLinks: Number((failedLinks.rows[0] as any)?.count ?? 0),
    floodWait24h: Number((floodWaitRows.rows[0] as any)?.count ?? 0),
  });
});

export default router;
