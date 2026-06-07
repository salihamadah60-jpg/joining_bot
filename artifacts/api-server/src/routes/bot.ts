import { Router, type IRouter } from "express";
import { eq, desc, and, gte, sql } from "drizzle-orm";
import { db, botStateTable, accountsTable, activityLogTable, groupLinksTable } from "@workspace/db";
import {
  GetBotStatusResponse,
  StartBotResponse,
  StopBotResponse,
  GetBotActivityResponse,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();

async function getBotState() {
  const [state] = await db.select().from(botStateTable).limit(1);
  if (!state) {
    const [newState] = await db.insert(botStateTable).values({ running: false }).returning();
    return newState;
  }
  return state;
}

function computeRotationInterval(accountCount: number): number {
  // Safety-first timing: fewer accounts = longer delays
  // 1 account: 900s (15min), 2: 600s, 3: 420s, 4: 300s, 5+: 240s min
  if (accountCount <= 0) return 900;
  if (accountCount === 1) return 900;
  if (accountCount === 2) return 600;
  if (accountCount === 3) return 420;
  if (accountCount === 4) return 300;
  return Math.max(240, Math.floor(900 / accountCount));
}

router.get("/bot/status", async (req, res): Promise<void> => {
  const state = await getBotState();
  const accounts = await db.select().from(accountsTable);
  const activeAccounts = accounts.filter((a) => a.status === "active");
  const rotationInterval = computeRotationInterval(activeAccounts.length);

  let currentAccountPhone: string | null = null;
  if (state.currentAccountId) {
    const [acc] = await db.select().from(accountsTable).where(eq(accountsTable.id, state.currentAccountId));
    currentAccountPhone = acc?.phone ?? null;
  }

  const pendingLinks = await db.select({ count: sql<number>`count(*)` }).from(groupLinksTable).where(eq(groupLinksTable.status, "pending"));
  const queueSize = Number(pendingLinks[0]?.count ?? 0);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const joinedToday = await db.select({ count: sql<number>`count(*)` })
    .from(activityLogTable)
    .where(and(eq(activityLogTable.type, "join_success"), gte(activityLogTable.createdAt, todayStart)));
  const failedToday = await db.select({ count: sql<number>`count(*)` })
    .from(activityLogTable)
    .where(and(eq(activityLogTable.type, "join_failed"), gte(activityLogTable.createdAt, todayStart)));

  res.json(GetBotStatusResponse.parse({
    running: state.running,
    currentAccountId: state.currentAccountId ?? null,
    currentAccountPhone,
    queueSize,
    rotationInterval,
    startedAt: state.startedAt ? state.startedAt.toISOString() : null,
    totalJoinedToday: Number(joinedToday[0]?.count ?? 0),
    totalFailedToday: Number(failedToday[0]?.count ?? 0),
  }));
});

router.post("/bot/start", async (req, res): Promise<void> => {
  const state = await getBotState();
  if (state.running) {
    res.json(StartBotResponse.parse({ running: true, currentAccountId: state.currentAccountId ?? null, currentAccountPhone: null, queueSize: 0, rotationInterval: 300, startedAt: state.startedAt ? state.startedAt.toISOString() : null, totalJoinedToday: 0, totalFailedToday: 0 }));
    return;
  }
  // Pick first active account
  const [firstAccount] = await db.select().from(accountsTable).where(eq(accountsTable.status, "active")).limit(1);
  const [updated] = await db.update(botStateTable).set({ running: true, startedAt: new Date(), currentAccountId: firstAccount?.id ?? null }).where(eq(botStateTable.id, state.id)).returning();

  // Log activity
  await db.insert(activityLogTable).values({ type: "bot_started", message: "Bot started", accountPhone: firstAccount?.phone ?? null });

  req.log.info("Bot started");

  // Re-use status handler logic inline
  const accounts = await db.select().from(accountsTable);
  const activeAccounts = accounts.filter((a) => a.status === "active");
  const rotationInterval = computeRotationInterval(activeAccounts.length);
  const pendingLinks = await db.select({ count: sql<number>`count(*)` }).from(groupLinksTable).where(eq(groupLinksTable.status, "pending"));

  res.json(StartBotResponse.parse({
    running: true,
    currentAccountId: updated.currentAccountId ?? null,
    currentAccountPhone: firstAccount?.phone ?? null,
    queueSize: Number(pendingLinks[0]?.count ?? 0),
    rotationInterval,
    startedAt: updated.startedAt ? updated.startedAt.toISOString() : null,
    totalJoinedToday: 0,
    totalFailedToday: 0,
  }));
});

router.post("/bot/stop", async (req, res): Promise<void> => {
  const state = await getBotState();
  const [updated] = await db.update(botStateTable).set({ running: false, currentAccountId: null, startedAt: null }).where(eq(botStateTable.id, state.id)).returning();
  await db.insert(activityLogTable).values({ type: "bot_stopped", message: "Bot stopped" });
  req.log.info("Bot stopped");
  res.json(StopBotResponse.parse({ running: false, currentAccountId: null, currentAccountPhone: null, queueSize: 0, rotationInterval: 900, startedAt: null, totalJoinedToday: 0, totalFailedToday: 0 }));
});

router.get("/bot/activity", async (req, res): Promise<void> => {
  const logs = await db.select().from(activityLogTable).orderBy(desc(activityLogTable.createdAt)).limit(100);
  res.json(GetBotActivityResponse.parse(logs.map((l) => ({
    ...l,
    createdAt: l.createdAt.toISOString(),
  }))));
});

export default router;
