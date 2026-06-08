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
  | "unknown";          // Unexpected error, may retry

export interface TelegramErrorInfo {
  action: TelegramErrorAction;
  code: string;
  waitSeconds?: number; // only for flood_wait
}

/**
 * Extract the error code string from any thrown error.
 * @mtcute errors have an `errorMessage` property (e.g. "FLOOD_WAIT_120").
 * Fallback: scan the message string for ALL_CAPS_CODES (min 3 chars).
 */
export function extractErrorCode(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;

    // @mtcute RpcError: errorMessage is the canonical Telegram error string
    if (typeof e["errorMessage"] === "string" && e["errorMessage"].length >= 2) {
      return (e["errorMessage"] as string).trim();
    }

    // Some @mtcute builds expose 'text' or 'rpcMessage'
    for (const key of ["text", "rpcMessage"]) {
      if (typeof e[key] === "string" && /^[A-Z][A-Z_]{2,}/.test(e[key] as string)) {
        return (e[key] as string).trim();
      }
    }

    if (typeof e["message"] === "string") {
      const msg = e["message"] as string;
      // Require ≥3 uppercase chars to avoid extracting single-letter initials
      // from CamelCase messages (e.g. "PeerIdInvalid" → "P" was the old bug)
      const match = msg.match(/\b([A-Z][A-Z_]{2,}(?:_\d+)?)\b/);
      if (match) return match[1]!;
      // Return the full message (truncated) so logs are useful
      return msg.substring(0, 100).replace(/\n/g, " ");
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
    const waitSeconds = parseInt(code.split("_")[2]!, 10);
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
      "INVITE_REQUEST_SENT",
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
