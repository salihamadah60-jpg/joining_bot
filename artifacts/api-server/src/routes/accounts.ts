import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, accountsTable } from "@workspace/db";
import {
  ListAccountsResponse,
  CreateAccountBody,
  GetAccountParams,
  GetAccountResponse,
  UpdateAccountParams,
  UpdateAccountBody,
  UpdateAccountResponse,
  DeleteAccountParams,
  GetAccountsStatsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/accounts/stats", async (req, res): Promise<void> => {
  const accounts = await db.select().from(accountsTable);
  const stats = {
    total: accounts.length,
    active: accounts.filter((a) => a.status === "active").length,
    paused: accounts.filter((a) => a.status === "paused").length,
    banned: accounts.filter((a) => a.status === "banned").length,
    floodWait: accounts.filter((a) => a.status === "flood_wait").length,
    needsAuth: accounts.filter((a) => a.status === "needs_auth").length,
    channelsLimit: accounts.filter((a) => a.status === "channels_limit").length,
    totalJoined: accounts.reduce((sum, a) => sum + a.joinedCount, 0),
    totalFailed: accounts.reduce((sum, a) => sum + a.failedCount, 0),
  };
  res.json(GetAccountsStatsResponse.parse(stats));
});

router.get("/accounts", async (req, res): Promise<void> => {
  const accounts = await db.select().from(accountsTable).orderBy(accountsTable.createdAt);
  res.json(ListAccountsResponse.parse(accounts.map(serializeAccount)));
});

router.post("/accounts", async (req, res): Promise<void> => {
  const parsed = CreateAccountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  // P2-1: Assign a unique device profile to each new account
  const { getDeviceProfileForPhone } = await import("../lib/deviceProfiles.js");
  const device = getDeviceProfileForPhone(parsed.data.phone);
  const [account] = await db.insert(accountsTable).values({
    ...parsed.data,
    deviceModel: device.deviceModel,
    systemVersion: device.systemVersion,
    appVersion: device.appVersion,
    systemLangCode: device.systemLangCode,
  }).returning();
  res.status(201).json(GetAccountResponse.parse(serializeAccount(account)));
});

router.get("/accounts/:id", async (req, res): Promise<void> => {
  const params = GetAccountParams.safeParse({
    id: Number(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id),
  });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [account] = await db.select().from(accountsTable).where(eq(accountsTable.id, params.data.id));
  if (!account) { res.status(404).json({ error: "Account not found" }); return; }
  res.json(GetAccountResponse.parse(serializeAccount(account)));
});

router.patch("/accounts/:id", async (req, res): Promise<void> => {
  const params = UpdateAccountParams.safeParse({
    id: Number(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id),
  });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateAccountBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [account] = await db
    .update(accountsTable)
    .set(parsed.data)
    .where(eq(accountsTable.id, params.data.id))
    .returning();
  if (!account) { res.status(404).json({ error: "Account not found" }); return; }
  res.json(UpdateAccountResponse.parse(serializeAccount(account)));
});

router.delete("/accounts/:id", async (req, res): Promise<void> => {
  const params = DeleteAccountParams.safeParse({
    id: Number(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id),
  });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [deleted] = await db.delete(accountsTable).where(eq(accountsTable.id, params.data.id)).returning();
  if (!deleted) { res.status(404).json({ error: "Account not found" }); return; }
  res.sendStatus(204);
});

function serializeAccount(a: typeof accountsTable.$inferSelect) {
  return {
    ...a,
    hasSession: !!a.sessionString,
    sessionString: undefined, // Never expose the session string via API
    floodWaitUntil: a.floodWaitUntil ? a.floodWaitUntil.toISOString() : null,
    lastJoinAt: a.lastJoinAt ? a.lastJoinAt.toISOString() : null,
    nextJoinAllowedAt: a.nextJoinAllowedAt ? a.nextJoinAllowedAt.toISOString() : null,
    dailyResetAt: a.dailyResetAt ? a.dailyResetAt.toISOString() : null,
    createdAt: a.createdAt.toISOString(),
  };
}

export default router;
