import { Router, type IRouter } from "express";
import { collections, getBotState, setBotState } from "@workspace/db";
import { engineStart, engineStop } from "../lib/telegramEngine.js";
import { SAFE_INTERVAL_PER_ACCOUNT_SECS, DAILY_LIMIT } from "../lib/timing.js";

const router: IRouter = Router();

router.get("/bot/status", async (req, res): Promise<void> => {
  const state = await getBotState();
  const accountsCol = await collections.accounts();
  const accounts = await accountsCol.find({}).toArray();
  const activeAccounts = accounts.filter((a) => a.status === "active");

  const linksCol = await collections.targetLinks();
  const queueSize = await linksCol.countDocuments({ status: "pending" });

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const activityCol = await collections.activityLog();
  const totalJoinedToday = await activityCol.countDocuments({
    type: "join_success",
    createdAt: { $gte: todayStart },
  });
  const totalFailedToday = await activityCol.countDocuments({
    type: "join_failed",
    createdAt: { $gte: todayStart },
  });

  res.json({
    running: state.running,
    currentAccountPhone: state.currentAccountPhone ?? null,
    currentAccountId: null,
    queueSize,
    rotationInterval: SAFE_INTERVAL_PER_ACCOUNT_SECS,
    startedAt: state.startedAt ? new Date(state.startedAt).toISOString() : null,
    forceActiveUntil: state.forceActiveUntil ? new Date(state.forceActiveUntil).toISOString() : null,
    totalJoinedToday,
    totalFailedToday,
  });
});

router.post("/bot/start", async (req, res): Promise<void> => {
  const accountsCol = await collections.accounts();
  const firstAccount = await accountsCol.findOne({ status: "active" });

  await setBotState({
    running: true,
    startedAt: new Date(),
    currentAccountPhone: firstAccount?.phone ?? null,
  });

  const activityCol = await collections.activityLog();
  await activityCol.insertOne({
    _id: new (await import("mongodb")).ObjectId(),
    type: "bot_started",
    message: `🚀 تم تشغيل البوت — الهدف: ${DAILY_LIMIT} انضمام / 18 ساعة / حساب`,
    accountPhone: firstAccount?.phone ?? null,
    linkUrl: null,
    errorCode: null,
    waitSeconds: null,
    createdAt: new Date(),
  });

  await engineStart();
  req.log.info("Bot started");

  const linksCol = await collections.targetLinks();
  const queueSize = await linksCol.countDocuments({ status: "pending" });

  res.json({
    running: true,
    currentAccountPhone: firstAccount?.phone ?? null,
    currentAccountId: null,
    queueSize,
    rotationInterval: SAFE_INTERVAL_PER_ACCOUNT_SECS,
    startedAt: new Date().toISOString(),
    totalJoinedToday: 0,
    totalFailedToday: 0,
  });
});

router.post("/bot/stop", async (req, res): Promise<void> => {
  await setBotState({ running: false, currentAccountPhone: null, startedAt: null });

  const { ObjectId } = await import("mongodb");
  const activityCol = await collections.activityLog();
  await activityCol.insertOne({
    _id: new ObjectId(),
    type: "bot_stopped",
    message: "⏹ تم إيقاف البوت",
    accountPhone: null,
    linkUrl: null,
    errorCode: null,
    waitSeconds: null,
    createdAt: new Date(),
  });

  await engineStop();
  req.log.info("Bot stopped");

  res.json({
    running: false,
    currentAccountPhone: null,
    currentAccountId: null,
    queueSize: 0,
    rotationInterval: SAFE_INTERVAL_PER_ACCOUNT_SECS,
    startedAt: null,
    totalJoinedToday: 0,
    totalFailedToday: 0,
  });
});

router.post("/bot/force-resume", async (req, res): Promise<void> => {
  const hours = Number((req.body as any)?.hours ?? 4);
  const forceActiveUntil = new Date(Date.now() + Math.min(hours, 12) * 60 * 60 * 1000);

  await setBotState({ running: true, forceActiveUntil, startedAt: new Date() });

  const { ObjectId } = await import("mongodb");
  const activityCol = await collections.activityLog();
  await activityCol.insertOne({
    _id: new ObjectId(),
    type: "engine_started",
    message: `⚡ تشغيل فوري — تجاوز وقت الراحة حتى ${forceActiveUntil.toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}`,
    accountPhone: null,
    linkUrl: null,
    errorCode: null,
    waitSeconds: null,
    createdAt: new Date(),
  });

  await engineStart();

  const linksCol = await collections.targetLinks();
  const queueSize = await linksCol.countDocuments({ status: "pending" });

  res.json({
    ok: true,
    running: true,
    forceActiveUntil: forceActiveUntil.toISOString(),
    queueSize,
  });
});

router.get("/bot/activity", async (req, res): Promise<void> => {
  const col = await collections.activityLog();
  const logs = await col.find({}).sort({ createdAt: -1 }).limit(100).toArray();
  res.json(logs.map((l) => ({
    id: l._id.toString(),
    type: l.type,
    message: l.message,
    accountPhone: l.accountPhone ?? null,
    linkUrl: l.linkUrl ?? null,
    errorCode: l.errorCode ?? null,
    waitSeconds: l.waitSeconds ?? null,
    createdAt: l.createdAt ? new Date(l.createdAt).toISOString() : new Date().toISOString(),
  })));
});

export default router;
