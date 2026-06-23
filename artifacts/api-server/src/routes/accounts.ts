import { Router, type IRouter } from "express";
import { ObjectId } from "mongodb";
import { collections } from "@workspace/db";
import { getClient } from "../lib/clientPool.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

function serializeAccount(a: any) {
  return {
    id: a._id.toString(),
    phone: a.phone,
    label: a.label ?? null,
    status: a.status,
    hasSession: !!a.sessionString,
    joinedCount: a.joinedCount ?? 0,
    failedCount: a.failedCount ?? 0,
    joinedToday: a.joinedToday ?? 0,
    dailyLimit: a.dailyLimit ?? 85,
    currentDelay: a.currentDelay ?? 1030,
    channelsCount: a.channelsCount ?? 0,
    isPremium: a.isPremium ?? false,
    deviceModel: a.deviceModel ?? null,
    systemVersion: a.systemVersion ?? null,
    appVersion: a.appVersion ?? null,
    systemLangCode: a.systemLangCode ?? null,
    specialty: a.specialty ?? "all",
    floodWaitUntil: a.floodWaitUntil ? new Date(a.floodWaitUntil).toISOString() : null,
    lastJoinAt: a.lastJoinAt ? new Date(a.lastJoinAt).toISOString() : null,
    nextJoinAllowedAt: a.nextJoinAllowedAt ? new Date(a.nextJoinAllowedAt).toISOString() : null,
    dailyResetAt: a.dailyResetAt ? new Date(a.dailyResetAt).toISOString() : null,
    createdAt: a.createdAt ? new Date(a.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: a.updatedAt ? new Date(a.updatedAt).toISOString() : new Date().toISOString(),
  };
}

router.get("/accounts/stats", async (req, res): Promise<void> => {
  const col = await collections.accounts();
  const accounts = await col.find({}).toArray();
  res.json({
    total: accounts.length,
    active: accounts.filter((a) => a.status === "active").length,
    paused: accounts.filter((a) => a.status === "paused").length,
    banned: accounts.filter((a) => a.status === "banned").length,
    floodWait: accounts.filter((a) => a.status === "flood_wait").length,
    needsAuth: accounts.filter((a) => a.status === "needs_auth").length,
    channelsLimit: accounts.filter((a) => a.status === "channels_limit").length,
    totalJoined: accounts.reduce((sum, a) => sum + (a.joinedCount ?? 0), 0),
    totalFailed: accounts.reduce((sum, a) => sum + (a.failedCount ?? 0), 0),
  });
});

router.get("/accounts", async (req, res): Promise<void> => {
  const col = await collections.accounts();
  const accounts = await col.find({}).sort({ createdAt: 1 }).toArray();
  res.json(accounts.map(serializeAccount));
});

router.post("/accounts", async (req, res): Promise<void> => {
  const body = req.body as { phone?: string; label?: string; status?: string; specialty?: string };
  if (!body?.phone || typeof body.phone !== "string") {
    res.status(400).json({ error: "phone is required" });
    return;
  }
  const { getDeviceProfileForPhone } = await import("../lib/deviceProfiles.js");
  const device = getDeviceProfileForPhone(body.phone);
  const now = new Date();
  const col = await collections.accounts();
  try {
    const result = await col.insertOne({
      _id: new ObjectId(),
      phone: body.phone,
      label: body.label ?? null,
      status: body.status ?? "active",
      sessionString: null,
      joinedCount: 0,
      failedCount: 0,
      joinedToday: 0,
      dailyLimit: 85,
      currentDelay: 1030,
      floodWaitUntil: null,
      lastJoinAt: null,
      nextJoinAllowedAt: null,
      dailyResetAt: null,
      channelsCount: 0,
      isPremium: false,
      deviceModel: device.deviceModel,
      systemVersion: device.systemVersion,
      appVersion: device.appVersion,
      systemLangCode: device.systemLangCode,
      specialty: (body.specialty && typeof body.specialty === "string" ? body.specialty : "all"),
      createdAt: now,
      updatedAt: now,
    });
    const account = await col.findOne({ _id: result.insertedId });
    res.status(201).json(serializeAccount(account));
  } catch (e: any) {
    if (e.code === 11000) {
      res.status(409).json({ error: "Account with this phone already exists" });
      return;
    }
    throw e;
  }
});

router.get("/accounts/:id", async (req, res): Promise<void> => {
  const id = req.params["id"];
  if (!id || !ObjectId.isValid(id)) {
    res.status(400).json({ error: "Invalid account id" });
    return;
  }
  const col = await collections.accounts();
  const account = await col.findOne({ _id: new ObjectId(id) });
  if (!account) { res.status(404).json({ error: "Account not found" }); return; }
  res.json(serializeAccount(account));
});

router.patch("/accounts/:id", async (req, res): Promise<void> => {
  const id = req.params["id"];
  if (!id || !ObjectId.isValid(id)) {
    res.status(400).json({ error: "Invalid account id" });
    return;
  }
  const body = req.body as Record<string, any>;
  const allowed = ["label", "status", "sessionString", "joinedCount", "failedCount",
    "joinedToday", "dailyLimit", "channelsCount", "isPremium", "deviceModel",
    "systemVersion", "appVersion", "systemLangCode", "specialty"];
  const updates: Record<string, any> = { updatedAt: new Date() };
  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }
  const col = await collections.accounts();
  const result = await col.findOneAndUpdate(
    { _id: new ObjectId(id) },
    { $set: updates },
    { returnDocument: "after" }
  );
  if (!result) { res.status(404).json({ error: "Account not found" }); return; }
  res.json(serializeAccount(result));
});

router.delete("/accounts/:id", async (req, res): Promise<void> => {
  const id = req.params["id"];
  if (!id || !ObjectId.isValid(id)) {
    res.status(400).json({ error: "Invalid account id" });
    return;
  }
  const col = await collections.accounts();
  const result = await col.deleteOne({ _id: new ObjectId(id) });
  if (result.deletedCount === 0) { res.status(404).json({ error: "Account not found" }); return; }
  res.sendStatus(204);
});

/** Quick ping — checks if the Telegram session is actually connected */
router.get("/accounts/:id/ping", async (req, res): Promise<void> => {
  const id = req.params["id"];
  if (!id || !ObjectId.isValid(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const col = await collections.accounts();
  const account = await col.findOne({ _id: new ObjectId(id) });
  if (!account) { res.status(404).json({ error: "Account not found" }); return; }
  if (!account.sessionString) {
    res.json({ connected: false, reason: "no_session" });
    return;
  }

  try {
    const client = await getClient(account.phone, account.sessionString, {});
    // getMe() is the lightest possible call — returns self user info
    const me = await (client as any).getMe();
    const firstName: string = me?.firstName ?? me?.first_name ?? "";
    const username: string = me?.username ?? "";
    res.json({ connected: true, firstName, username });
  } catch (err: any) {
    const msg: string = err?.message ?? String(err);
    // CRITICAL SAFETY RULE: NEVER wipe sessionString based on a ping failure.
    // A ping can fail due to temporary network issues, Telegram server blips, or
    // a duplicate-connection race condition — none of which mean the session is dead.
    // The only errors that truly mean the session is gone are:
    //   AUTH_KEY_UNREGISTERED, SESSION_REVOKED — and even then we keep the string
    //   in case the user wants to recover it manually.
    // AUTH_KEY_DUPLICATED is explicitly excluded: it means two connections existed,
    // not that the session expired.
    const isTrulyRevoked = /AUTH_KEY_UNREGISTERED|SESSION_REVOKED|USER_DEACTIVATED/i.test(msg);
    if (isTrulyRevoked) {
      // Only update status — NEVER set sessionString: null — keep it for recovery
      await col.updateOne({ _id: new ObjectId(id) }, { $set: { status: "needs_auth", updatedAt: new Date() } });
    }
    res.json({ connected: false, reason: msg.substring(0, 100) });
  }
});

router.post("/accounts/:id/sync-dialogs", async (req, res): Promise<void> => {
  const id = req.params["id"];
  if (!id || !ObjectId.isValid(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const col = await collections.accounts();
  const account = await col.findOne({ _id: new ObjectId(id) });
  if (!account) { res.status(404).json({ error: "Account not found" }); return; }
  if (!account.sessionString) { res.status(400).json({ error: "Account has no active session" }); return; }

  let client;
  try {
    client = await getClient(account.phone, account.sessionString, {});
  } catch (err) {
    logger.error({ err, phone: account.phone }, "Failed to get client for sync-dialogs");
    res.status(500).json({ error: "Failed to connect to Telegram" });
    return;
  }

  let count = 0;
  try {
    // Use raw MTProto messages.getDialogs — @mtcute client has no high-level getDialogs()
    // Fetch in batches of 100 until we have all dialogs (Telegram caps each call at 100 for most clients)
    const syncedCol = await collections.syncedDialogs();
    const syncedAt = new Date();
    const allChats: any[] = [];

    // Helper: fetch all group/channel chats from a given Telegram folder via pagination
    const fetchFolder = async (folderId: number) => {
      let offsetDate = 0;
      let offsetId = 0;
      let offsetPeer: any = { _: "inputPeerEmpty" };
      let page = 0;
      const MAX_PAGES = 20; // 20×100 = 2000 dialogs per folder

      while (page < MAX_PAGES) {
        const result: any = await (client as any).call({
          _: "messages.getDialogs",
          excludePinned: false,
          folderId,
          offsetDate,
          offsetId,
          offsetPeer,
          limit: 100,
          hash: BigInt(0),
        });

        const chats: any[] = result?.chats ?? [];
        const dialogs: any[] = result?.dialogs ?? [];

        const chatMap: Record<string, any> = {};
        for (const c of chats) {
          const id = String(c?.id ?? "");
          if (id) chatMap[id] = c;
        }

        const groupChats = chats.filter((c: any) => {
          const t: string = c?._ ?? "";
          return t === "chat" || t === "channel";
        });

        allChats.push(...groupChats);

        if (dialogs.length < 100) break;

        const lastDialog = dialogs[dialogs.length - 1];
        const lastMsg = (result?.messages ?? []).find(
          (m: any) => m?.id === lastDialog?.topMessage
        );
        offsetDate = lastMsg?.date ?? offsetDate;
        offsetId = lastDialog?.topMessage ?? 0;

        const lastPeer = lastDialog?.peer;
        if (lastPeer?._ === "peerChannel" || lastPeer?._ === "peerChat") {
          const chatId = lastPeer?.channelId ?? lastPeer?.chatId;
          const chat = chatMap[String(chatId)];
          if (chat) {
            if (chat?._ === "channel") {
              offsetPeer = {
                _: "inputPeerChannel",
                channelId: chatId,
                accessHash: chat?.accessHash ?? BigInt(0),
              };
            } else {
              offsetPeer = { _: "inputPeerChat", chatId };
            }
          }
        }

        page++;
      }
    };

    // Fetch from folder 0 (main inbox) AND folder 1 (archived)
    await fetchFolder(0);
    await fetchFolder(1).catch(() => {}); // archived folder may not exist — ignore errors

    // Deduplicate allChats by chatId (same chat may appear in multiple folders)
    const seenChatIds = new Set<string>();
    const uniqueChats = allChats.filter((c: any) => {
      const chatId = String(c?.id ?? "");
      if (!chatId || seenChatIds.has(chatId)) return false;
      seenChatIds.add(chatId);
      return true;
    });

    // Replace all synced data for this account
    await syncedCol.deleteMany({ accountPhone: account.phone });

    if (uniqueChats.length > 0) {
      const docs = uniqueChats.map((c: any) => {
        const chatId = String(c?.id ?? "");
        const title: string | null = c?.title ?? null;
        const username: string | null = c?.username ?? null;
        const chatType: string = c?._ === "channel"
          ? (c?.broadcast ? "channel" : "supergroup")
          : "group";
        const url = username ? `https://t.me/${username}` : null;
        return {
          _id: new ObjectId(),
          accountPhone: account.phone,
          chatId,
          title,
          username,
          url,
          chatType,
          syncedAt,
        };
      });

      await syncedCol.insertMany(docs, { ordered: false }).catch(() => {});
      count = uniqueChats.length;
    }

    logger.info({ phone: account.phone, count, folders: 2 }, "Dialog sync complete via MTProto");
  } catch (err) {
    logger.warn({ err, phone: account.phone }, "messages.getDialogs failed — falling back to JOINED count");
    try {
      const joinedCol = await collections.joined();
      count = await joinedCol.countDocuments({ accountPhone: account.phone });
    } catch (_) {
      count = account.channelsCount ?? 0;
    }
  }

  await col.updateOne({ _id: new ObjectId(id) }, { $set: { channelsCount: count, updatedAt: new Date() } });
  logger.info({ phone: account.phone, count }, "Dialog sync complete from Telegram");
  res.json({ channelsCount: count, synced: true });
});

/** GET /accounts/:id/groups — list all groups/channels for an account
 *  Priority: synced_dialogs (from Telegram live sync) → JOINED (bot-joined records)
 */
router.get("/accounts/:id/groups", async (req, res): Promise<void> => {
  const id = req.params["id"];
  if (!id || !ObjectId.isValid(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const col = await collections.accounts();
  const account = await col.findOne({ _id: new ObjectId(id) });
  if (!account) { res.status(404).json({ error: "Account not found" }); return; }

  // Use synced_dialogs if available (populated by sync button — real Telegram data)
  const syncedCol = await collections.syncedDialogs();
  const synced = await syncedCol
    .find({ accountPhone: account.phone })
    .sort({ syncedAt: -1 })
    .toArray();

  if (synced.length > 0) {
    res.json(synced.map((g: any) => ({
      id: g._id.toString(),
      url: g.url ?? null,
      groupTitle: g.title ?? null,
      groupType: g.chatType ?? null,
      joinedAt: g.syncedAt ? new Date(g.syncedAt).toISOString() : new Date().toISOString(),
      source: "telegram",
    })));
    return;
  }

  // Fallback: JOINED collection (groups this bot joined on behalf of the account)
  const joinedCol = await collections.joined();
  const groups = await joinedCol
    .find({ accountPhone: account.phone })
    .sort({ joinedAt: -1 })
    .toArray();

  res.json(groups.map((g: any) => ({
    id: g._id.toString(),
    url: g.url,
    groupTitle: g.groupTitle ?? null,
    groupType: g.groupType ?? null,
    joinedAt: g.joinedAt ? new Date(g.joinedAt).toISOString() : new Date().toISOString(),
    source: "bot",
  })));
});

export default router;
