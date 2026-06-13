/**
 * INVITE REQUEST CHECKER
 *
 * Periodically checks pending invite requests to see if the account
 * was approved by the group admin. Runs every 10 minutes.
 *
 * Strategy: For each pending invite_request, call messages.checkChatInvite
 * with the hash from the URL. If the server returns chatInviteAlready,
 * the user is a member and the request was approved.
 */

import { collections, ObjectId } from "@workspace/db";
import type { InviteRequestDoc } from "@workspace/db";
import { getPooledClientOnly } from "./clientPool.js";
import { logger } from "./logger.js";
import { extractErrorCode } from "./telegramErrors.js";
import { eventBus } from "./eventBus.js";

const CHECK_INTERVAL_MS = 10 * 60_000; // 10 minutes
let checkerTimer: NodeJS.Timeout | null = null;

export function startInviteRequestChecker(): void {
  if (checkerTimer) return;
  checkerTimer = setInterval(() => {
    runCheck().catch((e) => logger.error({ err: e }, "Invite request check cycle failed"));
  }, CHECK_INTERVAL_MS);

  // Also run once shortly after startup
  setTimeout(() => {
    runCheck().catch((e) => logger.warn({ err: e }, "Initial invite request check failed"));
  }, 15_000);

  logger.info("Invite request checker started (10-minute interval)");
}

export async function runCheck(): Promise<{ checked: number; approved: number; expired: number }> {
  const inviteCol = await collections.inviteRequests();
  const pending = await inviteCol.find({ status: "pending" }).toArray();

  let approved = 0;
  let expired = 0;

  for (const doc of pending) {
    const result = await checkOne(doc);
    if (result === "approved") approved++;
    else if (result === "expired") expired++;
  }

  if (pending.length > 0) {
    logger.info({ total: pending.length, approved, expired }, "Invite request check complete");
  }

  return { checked: pending.length, approved, expired };
}

async function checkOne(doc: InviteRequestDoc): Promise<"approved" | "expired" | "pending"> {
  // Only use an ALREADY POOLED (engine-managed) client.
  // Creating a new connection would risk AUTH_KEY_DUPLICATED if the engine
  // already has an active connection for this phone with the same auth key.
  const client = getPooledClientOnly(doc.accountPhone);
  if (!client) {
    // Account not currently connected — skip this check cycle safely
    logger.debug({ phone: doc.accountPhone, url: doc.url }, "Invite check skipped — account not in pool");
    return "pending";
  }

  // Extract invite hash from URL (handles t.me/+HASH and t.me/joinchat/HASH)
  const hashMatch = doc.url.match(/t\.me\/(?:joinchat\/|\+)([a-zA-Z0-9_-]+)/i);
  if (!hashMatch) return "pending"; // Can't check username-based links

  const hash = hashMatch[1]!;

  try {

    const info = await (client as any).call({
      _: "messages.checkChatInvite",
      hash,
    });

    // chatInviteAlready or chatInvitePeek means user is already a member
    if (info?._ === "chatInviteAlready" || info?.className === "ChatInviteAlready" ||
        info?._ === "chatInvitePeek" || info?.className === "ChatInvitePeek") {
      await markApproved(doc, info?.chat?.title ?? null);
      return "approved";
    }

    return "pending";
  } catch (e: any) {
    const code = extractErrorCode(e);

    if (code === "INVITE_HASH_EXPIRED" || code === "INVITE_HASH_INVALID") {
      await markExpired(doc);
      return "expired";
    }

    if (code === "USER_ALREADY_PARTICIPANT") {
      await markApproved(doc, null);
      return "approved";
    }

    logger.warn({ code, url: doc.url, phone: doc.accountPhone }, "Invite request check error (will retry)");
    return "pending";
  }
}

async function markApproved(doc: InviteRequestDoc, groupTitle: string | null): Promise<void> {
  const inviteCol = await collections.inviteRequests();
  await inviteCol.updateOne(
    { _id: doc._id },
    {
      $set: {
        status: "approved",
        groupTitle,
        approvedAt: new Date(),
        updatedAt: new Date(),
      },
    }
  );

  // Also update TARGET_LINKS and JOINED collection
  const targetCol = await collections.targetLinks();
  const joinedCol = await collections.joined();

  await targetCol.updateOne(
    { url: doc.url, usedByAccountPhone: doc.accountPhone },
    { $set: { status: "joined", processedAt: new Date() } }
  );

  try {
    await joinedCol.insertOne({
      _id: new ObjectId(),
      url: doc.url,
      accountPhone: doc.accountPhone,
      groupTitle,
      groupType: null,
      joinedAt: new Date(),
    });
  } catch (_) {}

  logger.info({ url: doc.url, phone: doc.accountPhone, groupTitle }, "Invite request approved");

  // Publish SSE notification so the dashboard shows a real-time toast
  eventBus.publish({
    type: "invite_request_approved",
    message: `✅ تم قبول طلب الانضمام: ${groupTitle ?? doc.url} [${doc.accountPhone}]`,
    accountPhone: doc.accountPhone,
    linkUrl: doc.url,
    timestamp: new Date().toISOString(),
  });
}

async function markExpired(doc: InviteRequestDoc): Promise<void> {
  const inviteCol = await collections.inviteRequests();
  await inviteCol.updateOne(
    { _id: doc._id },
    { $set: { status: "expired", updatedAt: new Date() } }
  );

  const targetCol = await collections.targetLinks();
  await targetCol.updateOne(
    { url: doc.url, usedByAccountPhone: doc.accountPhone },
    { $set: { status: "failed", failReason: "INVITE_HASH_EXPIRED", processedAt: new Date() } }
  );
}
