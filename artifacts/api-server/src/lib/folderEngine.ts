/**
 * FOLDER ENGINE — Feature 5: Telegram Dialog Filter (Folder) management
 *
 * Creates / lists / deletes Telegram "folders" (dialog filters) on a specific account.
 * Uses raw TL calls: messages.getDialogFilters + messages.updateDialogFilter.
 *
 * Peer resolution strategy:
 *   1. If the dialog has a `username` → resolvePeer('@username')
 *   2. If chatType is a plain group → inputPeerChat{chatId} (no accessHash needed)
 *   3. Otherwise → try resolvePeer(Number(chatId)) — works if @mtcute has it cached
 *      from when the account originally joined the group.
 */

import { collections } from "@workspace/db";
import { logger } from "./logger.js";
import { getClientWithRetry } from "./leaveEngine.js";
import { getDeviceProfileForPhone } from "./deviceProfiles.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FolderInfo {
  id: number;
  title: string;
  emoticon: string | null;
  peerCount: number;
}

export interface CreateFolderResult {
  ok: boolean;
  folderId: number;
  added: number;
  total: number;
  skipped: number;
  error?: string;
}

// ─── InputPeer resolver ───────────────────────────────────────────────────────

async function resolveInputPeer(
  client: any,
  username: string | null | undefined,
  chatId: string | null | undefined,
  chatType: string | null | undefined
): Promise<any | null> {
  // 1. Prefer username resolution — most reliable
  if (username) {
    try {
      const peer = await client.resolvePeer(username.startsWith("@") ? username : `@${username}`);
      if (peer) return peer;
    } catch {
      // fall through to chatId approach
    }
  }

  if (!chatId) return null;
  const numId = Number(chatId);
  if (!numId || isNaN(numId)) return null;

  // 2. Plain group (chatType = "group" / "basicGroup") — chatId is int (32-bit), NOT int64
  if (chatType === "group" || chatType === "basicGroup") {
    return { _: "inputPeerChat", chatId: numId };
  }

  // 3. Channel / supergroup — try resolvePeer by numeric ID (works if peer is cached)
  try {
    const peer = await client.resolvePeer(numId);
    if (peer) return peer;
  } catch { /* skip */ }

  return null;
}

// ─── List folders ─────────────────────────────────────────────────────────────

export async function getAccountFolders(phone: string): Promise<FolderInfo[]> {
  const accountsCol = await collections.accounts();
  const account = await accountsCol.findOne({ phone });
  if (!account?.sessionString) return [];

  const dp = getDeviceProfileForPhone(phone);
  const client = await getClientWithRetry(phone, account.sessionString, dp);

  try {
    const result: any = await (client as any).call({ _: "messages.getDialogFilters" });
    const filters: any[] = result?.filters ?? result ?? [];

    return filters
      .filter((f: any) => f._ === "dialogFilter")
      .map((f: any) => ({
        id: f.id,
        title: f.title?.text ?? f.title ?? String(f.id),
        emoticon: f.emoticon ?? null,
        peerCount: (f.includePeers?.length ?? 0) + (f.pinnedPeers?.length ?? 0),
      }));
  } catch (e: any) {
    logger.warn({ phone, err: e.message }, "getDialogFilters failed");
    return [];
  }
}

// ─── Create / update folder ───────────────────────────────────────────────────

export async function createAccountFolder(
  phone: string,
  title: string,
  dialogs: { username?: string | null; chatId?: string | null; chatType?: string | null }[],
  emoticon?: string
): Promise<CreateFolderResult> {
  const accountsCol = await collections.accounts();
  const account = await accountsCol.findOne({ phone });
  if (!account?.sessionString) {
    return { ok: false, folderId: 0, added: 0, total: 0, skipped: 0, error: "No session" };
  }

  const dp = getDeviceProfileForPhone(phone);
  const client = await getClientWithRetry(phone, account.sessionString, dp);

  // ── Find next available folder ID (2-255, avoid conflicts) ──
  let nextId = 2;
  try {
    const existing: any = await (client as any).call({ _: "messages.getDialogFilters" });
    const existingIds = new Set<number>(
      (existing?.filters ?? existing ?? [])
        .filter((f: any) => typeof f.id === "number")
        .map((f: any) => f.id)
    );
    while (existingIds.has(nextId) && nextId < 255) nextId++;
  } catch { /* ignore — use 2 */ }

  // ── Resolve InputPeers in parallel (batches of 10) — Telegram's folder limit is 100 peers ──
  const MAX_PEERS = 100;
  const workList = dialogs.slice(0, MAX_PEERS * 2); // over-fetch, stop once we have 100 resolved
  const CONCURRENCY = 10;

  const inputPeers: any[] = [];
  let skipped = 0;

  for (let i = 0; i < workList.length && inputPeers.length < MAX_PEERS; i += CONCURRENCY) {
    const batch = workList.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((d) => resolveInputPeer(client, d.username, d.chatId, d.chatType))
    );
    for (const r of results) {
      if (inputPeers.length >= MAX_PEERS) break;
      if (r.status === "fulfilled" && r.value) inputPeers.push(r.value);
      else skipped++;
    }
  }
  // Count the dialogs we didn't even try as skipped
  skipped += Math.max(0, dialogs.length - workList.length);

  if (inputPeers.length === 0) {
    return {
      ok: false, folderId: nextId, added: 0,
      total: dialogs.length, skipped,
      error: "Could not resolve any peers — group usernames may be needed",
    };
  }

  // ── Create folder via TL ──
  try {
    await (client as any).call({
      _: "messages.updateDialogFilter",
      id: nextId,
      filter: {
        _: "dialogFilter",
        id: nextId,
        title: { _: "textWithEntities", text: title, entities: [] },
        emoticon: emoticon ?? "🏥",
        pinnedPeers: [],
        includePeers: inputPeers,
        excludePeers: [],
        contacts: false,
        nonContacts: false,
        groups: false,
        broadcasts: false,
        bots: false,
        excludeMuted: false,
        excludeRead: false,
        excludeArchived: false,
      },
    });

    logger.info({ phone, folderId: nextId, title, peers: inputPeers.length }, "Telegram folder created ✅");
    return { ok: true, folderId: nextId, added: inputPeers.length, total: dialogs.length, skipped };
  } catch (e: any) {
    const errMsg = e?.message ?? String(e);
    logger.warn({ phone, folderId: nextId, err: errMsg }, "Failed to create Telegram folder");
    return { ok: false, folderId: nextId, added: 0, total: dialogs.length, skipped, error: errMsg };
  }
}

// ─── Delete folder ────────────────────────────────────────────────────────────

export async function deleteAccountFolder(
  phone: string,
  folderId: number
): Promise<{ ok: boolean; error?: string }> {
  const accountsCol = await collections.accounts();
  const account = await accountsCol.findOne({ phone });
  if (!account?.sessionString) return { ok: false, error: "No session" };

  const dp = getDeviceProfileForPhone(phone);
  const client = await getClientWithRetry(phone, account.sessionString, dp);

  try {
    // Pass no filter to delete (Telegram removes the folder when filter is absent)
    await (client as any).call({
      _: "messages.updateDialogFilter",
      id: folderId,
    });
    logger.info({ phone, folderId }, "Telegram folder deleted");
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

// ─── Medical keyword classifier ───────────────────────────────────────────────

const MEDICAL_KEYWORDS = [
  // Arabic
  "طب", "طبي", "طبية", "صحة", "صحي", "صحية", "دكتور", "دكاترة", "دكترة",
  "مستشفى", "مستشفيات", "عيادة", "عيادات", "تمريض", "ممرض", "ممرضة",
  "صيدلة", "صيدلي", "دواء", "أدوية", "علاج", "علاجي", "مرض", "أمراض",
  "جراحة", "جراح", "باطنية", "أطفال", "نساء", "توليد", "عظام", "قلب",
  "أشعة", "مختبر", "تشخيص", "طوارئ", "أسنان", "عيون", "جلدية", "نفسية",
  "تغذية", "فسيولوجيا", "تشريح", "فارماكولوجي", "بيولوجيا",
  // English
  "medic", "health", "doctor", "hospital", "clinic", "nurse", "pharmacy",
  "pharma", "surgery", "pediatric", "cardio", "radiology", "dentist",
  "ophthalmol", "dermatol", "oncol", "gynecol", "orthopedic",
];

function isMedicalTitle(title: string | null): boolean {
  if (!title) return false;
  const lower = title.toLowerCase();
  return MEDICAL_KEYWORDS.some((kw) => lower.includes(kw));
}

// ─── Convenience: create medical groups folder ────────────────────────────────

export async function createMedicalGroupsFolder(
  phone: string,
  title = "طبية 🏥"
): Promise<CreateFolderResult> {
  const syncedCol = await collections.syncedDialogs();
  const all = await syncedCol.find({ accountPhone: phone }).toArray();

  if (all.length === 0) {
    return {
      ok: false, folderId: 0, added: 0, total: 0, skipped: 0,
      error: "No synced dialogs found — press the sync button next to the account first",
    };
  }

  const medical = all.filter((d) => isMedicalTitle(d.title));

  if (medical.length === 0) {
    return {
      ok: false, folderId: 0, added: 0, total: all.length, skipped: 0,
      error: `No medical groups found among ${all.length} synced dialogs — titles don't match medical keywords`,
    };
  }

  logger.info({ phone, total: all.length, medical: medical.length }, "Creating medical folder from synced dialogs");

  return createAccountFolder(
    phone,
    title,
    medical.map((d) => ({ username: d.username, chatId: d.chatId, chatType: d.chatType }))
  );
}
