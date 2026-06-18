/**
 * MONGODB SERVICE LAYER
 *
 * Single source of truth for all database access.
 * Replaces PostgreSQL/Drizzle entirely.
 * Uses MONGODB_URL env var (database: Joining_links).
 *
 * Collections:
 *   accounts        — Telegram accounts + session strings
 *   settings        — key/value config
 *   bot_state       — singleton doc (running/stopped)
 *   activity_log    — engine event logs
 *   TARGET_LINKS    — links queued to join
 *   JOINED          — links already joined (dedup across restarts)
 *   Channels        — detected channel links
 *   join_history    — per-attempt join records
 *   mongo_collections — external MongoDB sync sources
 *   tg_sessions     — session backup (existing, unchanged)
 */

import { MongoClient, ObjectId, type Collection, type Db } from "mongodb";
import type { Filter, UpdateFilter, FindOptions } from "mongodb";

// ─── Document interfaces ──────────────────────────────────────────────────────

export interface AccountDoc {
  _id: ObjectId;
  phone: string;
  label: string | null;
  status: string;
  sessionString: string | null;
  joinedCount: number;
  failedCount: number;
  joinedToday: number;
  dailyLimit: number;
  currentDelay: number;
  floodWaitUntil: Date | null;
  lastJoinAt: Date | null;
  nextJoinAllowedAt: Date | null;
  dailyResetAt: Date | null;
  channelsCount: number;
  isPremium: boolean;
  deviceModel: string | null;
  systemVersion: string | null;
  appVersion: string | null;
  systemLangCode: string | null;
  // ── Account Specialization ───────────────────────────────────────────────────
  // "all" = joins any medical group (default).
  // All other values are medical sub-specialties — only relevant medical groups
  // are kept; others are auto-queued for leaving.
  // See MEDICAL_SPECIALTIES in Accounts.tsx for the full list.
  specialty: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TargetLinkDoc {
  _id: ObjectId;
  url: string;
  status: string; // pending | joined | failed | skipped
  failReason: string | null;
  groupTitle: string | null;
  groupType: string | null;
  source: string | null;
  // specialty: the medical sub-specialty this link belongs to.
  // null / undefined = untagged (processed only by "all" accounts).
  // Any other string = processed only by accounts with that specialty.
  specialty: string | null;
  usedByAccountPhone: string | null;
  retryCount: number;
  retryAfter: Date | null;
  createdAt: Date;
  processedAt: Date | null;
}

export interface JoinedDoc {
  _id: ObjectId;
  url: string;
  accountPhone: string;
  groupTitle: string | null;
  groupType: string | null;
  joinedAt: Date;
}

export interface ChannelDoc {
  _id: ObjectId;
  url: string;
  title: string | null;
  detectedAt: Date;
}

export interface ActivityLogDoc {
  _id: ObjectId;
  type: string;
  message: string;
  accountPhone: string | null;
  linkUrl: string | null;
  errorCode: string | null;
  waitSeconds: number | null;
  createdAt: Date;
}

export interface BotStateDoc {
  _id: string; // always "singleton"
  running: boolean;
  currentAccountPhone: string | null;
  startedAt: Date | null;
  forceActiveUntil: Date | null; // temporary override: skip blackout until this time
  updatedAt: Date;
}

export interface SettingDoc {
  _id: ObjectId;
  key: string;
  value: string;
  updatedAt: Date;
}

export interface JoinHistoryDoc {
  _id: ObjectId;
  accountPhone: string;
  linkUrl: string;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
}

export interface MongoCollectionDoc {
  _id: ObjectId;
  name: string;
  connectionString: string;
  dbName: string;
  linkField: string;
  isActive: boolean;
  lastSyncAt: Date | null;
  syncedCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface LearnedPatternDoc {
  _id: ObjectId;
  groupTitle: string;
  decision: "relevant" | "not_relevant";
  keywords: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface InviteRequestDoc {
  _id: ObjectId;
  url: string;
  accountPhone: string;
  status: "pending" | "approved" | "expired";
  groupTitle: string | null;
  sentAt: Date;
  approvedAt: Date | null;
  updatedAt: Date;
}

export interface SyncedDialogDoc {
  _id: ObjectId;
  accountPhone: string;
  chatId: string;
  title: string | null;
  username: string | null;
  url: string | null;
  chatType: string | null;
  syncedAt: Date;
}

export interface LeftGroupDoc {
  _id: ObjectId;
  url: string;
  accountPhone: string;
  title: string | null;
  chatType: string | null;
  reason: string;
  leftAt: Date;
}

// Leave Queue — persistent per-account list of groups to leave (processed safely one-by-one)
export interface LeaveQueueDoc {
  _id: ObjectId;
  accountPhone: string;
  url: string | null;
  username: string | null;
  chatId: string | null;
  title: string | null;
  chatType: string | null;
  reason: string;
  status: "pending" | "processing" | "done" | "failed";
  errorMessage: string | null;
  addedAt: Date;
  processedAt: Date | null;
}

// ─── Connection singleton ─────────────────────────────────────────────────────

let _client: MongoClient | null = null;
let _db: Db | null = null;

function extractDbName(url: string): string {
  try {
    // Normalize mongodb+srv:// and mongodb:// to https:// so URL parser can handle them
    const normalized = url
      .replace(/^mongodb\+srv:\/\//, "https://")
      .replace(/^mongodb:\/\//, "https://");
    const parsed = new URL(normalized);
    // pathname is "/dbname" or "/" or ""
    const dbName = parsed.pathname.slice(1).split("?")[0].trim();
    if (dbName && !dbName.includes(".") && dbName !== "") {
      return dbName;
    }
  } catch {}
  return "Joining_links";
}

export async function getDb(): Promise<Db> {
  if (_db) return _db;

  const url = process.env["MONGODB_URL"];
  if (!url) throw new Error("MONGODB_URL environment variable is required");

  const dbName = extractDbName(url) || "Joining_links";

  _client = new MongoClient(url, {
    serverSelectionTimeoutMS: 15_000,
    connectTimeoutMS: 15_000,
  });
  await _client.connect();
  _db = _client.db(dbName);
  return _db;
}

// ─── Typed collection accessors ───────────────────────────────────────────────

export async function col<T extends object>(name: string): Promise<Collection<T>> {
  const db = await getDb();
  return db.collection<T>(name);
}

export const collections = {
  accounts: () => col<AccountDoc>("accounts"),
  settings: () => col<SettingDoc>("settings"),
  botState: () => col<BotStateDoc>("bot_state"),
  activityLog: () => col<ActivityLogDoc>("activity_log"),
  targetLinks: () => col<TargetLinkDoc>("TARGET_LINKS"),
  joined: () => col<JoinedDoc>("JOINED"),
  channels: () => col<ChannelDoc>("Channels"),
  joinHistory: () => col<JoinHistoryDoc>("join_history"),
  mongoCollections: () => col<MongoCollectionDoc>("mongo_collections"),
  learnedPatterns: () => col<LearnedPatternDoc>("learned_patterns"),
  inviteRequests: () => col<InviteRequestDoc>("invite_requests"),
  syncedDialogs: () => col<SyncedDialogDoc>("synced_dialogs"),
  leftGroups: () => col<LeftGroupDoc>("left_groups"),
  leaveQueue: () => col<LeaveQueueDoc>("leave_queue"),
} as const;

// ─── Init: create indexes + ensure bot_state singleton ───────────────────────

export async function initMongo(): Promise<void> {
  const db = await getDb();

  // accounts — unique on phone
  await db.collection("accounts").createIndex({ phone: 1 }, { unique: true });
  await db.collection("accounts").createIndex({ status: 1 });
  await db.collection("accounts").createIndex({ createdAt: 1 });

  // settings — unique on key
  await db.collection("settings").createIndex({ key: 1 }, { unique: true });

  // TARGET_LINKS — unique on url
  await db.collection("TARGET_LINKS").createIndex({ url: 1 }, { unique: true });
  await db.collection("TARGET_LINKS").createIndex({ status: 1 });
  await db.collection("TARGET_LINKS").createIndex({ createdAt: 1 });
  await db.collection("TARGET_LINKS").createIndex({ retryAfter: 1 });

  // JOINED — unique on url
  await db.collection("JOINED").createIndex({ url: 1 }, { unique: true });
  await db.collection("JOINED").createIndex({ joinedAt: -1 });

  // Channels — unique on url
  await db.collection("Channels").createIndex({ url: 1 }, { unique: true });

  // activity_log
  await db.collection("activity_log").createIndex({ createdAt: -1 });
  await db.collection("activity_log").createIndex({ type: 1 });

  // join_history
  await db.collection("join_history").createIndex({ accountPhone: 1 });
  await db.collection("join_history").createIndex({ createdAt: -1 });

  // mongo_collections
  await db.collection("mongo_collections").createIndex({ createdAt: 1 });

  // tg_sessions backup (keep existing index)
  await db.collection("tg_sessions").createIndex({ phone: 1 }, { unique: true });

  // learned_patterns
  await db.collection("learned_patterns").createIndex({ groupTitle: 1 }, { unique: true });

  // invite_requests
  await db.collection("invite_requests").createIndex({ url: 1, accountPhone: 1 }, { unique: true });
  await db.collection("invite_requests").createIndex({ status: 1 });
  await db.collection("invite_requests").createIndex({ sentAt: -1 });

  // synced_dialogs — full list of groups/channels per account (from Telegram sync)
  await db.collection("synced_dialogs").createIndex({ accountPhone: 1, chatId: 1 }, { unique: true });
  await db.collection("synced_dialogs").createIndex({ accountPhone: 1 });
  await db.collection("synced_dialogs").createIndex({ syncedAt: -1 });

  // left_groups — history of groups that were left
  await db.collection("left_groups").createIndex({ accountPhone: 1 });
  await db.collection("left_groups").createIndex({ leftAt: -1 });
  await db.collection("left_groups").createIndex({ url: 1 });

  // leave_queue — persistent queue for safe sequential leaving
  await db.collection("leave_queue").createIndex({ accountPhone: 1, status: 1 });
  await db.collection("leave_queue").createIndex({ addedAt: 1 });

  // ── Backfill: add `specialty` default to existing accounts that predate the field ──
  await db.collection("accounts").updateMany(
    { specialty: { $exists: false } },
    { $set: { specialty: "all" } }
  );

  // Ensure bot_state singleton exists
  await db.collection<BotStateDoc>("bot_state").updateOne(
    { _id: "singleton" as any },
    {
      $setOnInsert: {
        _id: "singleton" as any,
        running: false,
        currentAccountPhone: null,
        startedAt: null,
        forceActiveUntil: null as Date | null,
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  );
}

// ─── Settings helper ──────────────────────────────────────────────────────────

export async function getSettings(): Promise<Record<string, string>> {
  const col = await collections.settings();
  const rows = await col.find({}).toArray();
  const kv: Record<string, string> = {};
  for (const r of rows) kv[r.key] = r.value;
  return kv;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const col = await collections.settings();
  await col.updateOne(
    { key },
    { $set: { key, value, updatedAt: new Date() } },
    { upsert: true }
  );
}

// ─── Bot state helper ─────────────────────────────────────────────────────────

export async function getBotState(): Promise<BotStateDoc> {
  const col = await collections.botState();
  let state = await col.findOne({ _id: "singleton" as any });
  if (!state) {
    await col.insertOne({
      _id: "singleton" as any,
      running: false,
      currentAccountPhone: null,
      startedAt: null,
      forceActiveUntil: null as Date | null,
      updatedAt: new Date(),
    });
    state = await col.findOne({ _id: "singleton" as any });
  }
  return state!;
}

export async function setBotState(update: Partial<Omit<BotStateDoc, "_id">>): Promise<void> {
  const col = await collections.botState();
  await col.updateOne(
    { _id: "singleton" as any },
    { $set: { ...update, updatedAt: new Date() } },
    { upsert: true }
  );
}

// Re-export ObjectId for use elsewhere
export { ObjectId };
