/**
 * TELEGRAM ERROR HANDLING
 *
 * Complete coverage of all MTProto errors relevant to group joining.
 * Each error is classified into an action category.
 */

export type TelegramErrorAction =
  | "flood_wait"        // Wait N seconds, retry link later
  | "peer_flood"        // Account severely flooded, pause 24h
  | "channels_limit"    // Account has too many channels, pause
  | "link_failed"       // Permanent failure for this link
  | "already_joined"    // Link already joined (count as success)
  | "auth_revoked"      // Session expired, account needs re-auth
  | "account_banned"    // Account banned by Telegram
  | "unknown";          // Unexpected error, treat as link failure

export interface TelegramErrorInfo {
  action: TelegramErrorAction;
  code: string;
  waitSeconds?: number; // only for flood_wait
}

/**
 * Extract the error code string from any thrown error.
 * @mtcute errors have an `errorMessage` property or the message matches the code.
 */
export function extractErrorCode(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    if (typeof e["errorMessage"] === "string") return e["errorMessage"] as string;
    if (typeof e["message"] === "string") {
      const msg = e["message"] as string;
      // Typical format: "FLOOD_WAIT_120" or "Telegram error: FLOOD_WAIT_120"
      const match = msg.match(/([A-Z_]+(?:_\d+)?)/);
      if (match) return match[1];
      return msg.substring(0, 80);
    }
  }
  return "UNKNOWN";
}

/**
 * Classify a Telegram error into an action category with metadata.
 */
export function classifyTelegramError(err: unknown): TelegramErrorInfo {
  const code = extractErrorCode(err);

  // FLOOD_WAIT_N — must wait N seconds
  if (/^FLOOD_WAIT_(\d+)$/.test(code)) {
    const waitSeconds = parseInt(code.split("_")[2], 10);
    return { action: "flood_wait", code, waitSeconds };
  }

  // PEER_FLOOD — severely rate-limited, 24h pause
  if (code === "PEER_FLOOD") {
    return { action: "peer_flood", code, waitSeconds: 24 * 3600 };
  }

  // Too many channels
  if (code === "CHANNELS_TOO_MUCH") {
    return { action: "channels_limit", code };
  }

  // Already a participant — treat as success
  if (code === "USER_ALREADY_PARTICIPANT") {
    return { action: "already_joined", code };
  }

  // Auth / session revoked errors
  if (
    [
      "AUTH_KEY_UNREGISTERED",
      "AUTH_KEY_INVALID",
      "AUTH_KEY_DUPLICATED",
      "SESSION_EXPIRED",
      "SESSION_REVOKED",
      "USER_DEACTIVATED",
      "USER_DEACTIVATED_BAN",
    ].includes(code)
  ) {
    return { action: "auth_revoked", code };
  }

  // Account banned
  if (code === "PHONE_NUMBER_BANNED") {
    return { action: "account_banned", code };
  }

  // Permanent link failures (link is dead or we're blocked from it)
  if (
    [
      "INVITE_HASH_EXPIRED",
      "INVITE_HASH_INVALID",
      "USERNAME_NOT_OCCUPIED",
      "USERNAME_INVALID",
      "CHANNEL_PRIVATE",
      "USER_BANNED_IN_CHANNEL",
      "CHAT_ADMIN_REQUIRED",
      "PEER_ID_INVALID",
      "INVITE_REQUEST_SENT", // Already sent a request (treat as link handled)
      "JOIN_AS_PEER_INVALID",
      "CHANNEL_ID_INVALID",
      "MSG_ID_INVALID",
      "CHAT_ID_INVALID",
    ].includes(code)
  ) {
    return { action: "link_failed", code };
  }

  return { action: "unknown", code };
}
