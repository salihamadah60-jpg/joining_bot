/**
 * VERIFICATION CHALLENGE HANDLER
 *
 * After joining a Telegram group, some admin bots send a challenge message
 * that requires the user to prove they're human. If ignored, the bot kicks
 * the account from the group.
 *
 * This handler detects and automatically responds to the three most common
 * challenge types:
 *
 *   1. Inline keyboard button click  (e.g. "Click ✅ to verify")
 *   2. Text keyword challenge         (e.g. "Type the word 'hello' to enter")
 *   3. Math problem                   (e.g. "What is 4 + 7? Reply with the answer")
 *   4. /start command                 (e.g. "Send /start to the group bot")
 *
 * The handler runs FIRE-AND-FORGET alongside `observeGroupAfterJoin` so it
 * does NOT add extra delay to the join flow.
 *
 * Safety: every step is wrapped in try/catch — failure is silent and
 * non-critical (the group is still recorded as joined).
 */

import type { TelegramClient } from "@mtcute/node";
import { logger } from "./logger.js";

// ─── Tuning constants ─────────────────────────────────────────────────────────

/** Milliseconds to wait after joining before fetching messages (bots need a moment). */
const INITIAL_WAIT_MS = 3_000;

/** Milliseconds between re-check attempts when no challenge found yet. */
const RECHECK_INTERVAL_MS = 4_000;

/** Maximum number of re-check attempts before giving up. */
const MAX_ATTEMPTS = 4;

/** Number of recent messages to inspect per attempt. */
const MSG_FETCH_LIMIT = 8;

// ─── Keyword lists ────────────────────────────────────────────────────────────

/**
 * Button texts that strongly indicate a "verification / agree" button.
 * Checked case-insensitively and as substring.
 */
const VERIFY_BUTTON_KEYWORDS = [
  // Common emoji signals
  "✅", "☑", "✔",
  // English
  "verify", "verified", "confirm", "agree", "accept", "i agree",
  "i'm human", "not a robot", "human", "continue", "proceed",
  "enter", "join", "start", "click here",
  // Arabic
  "تحقق", "موافق", "موافقة", "قبول", "قبلت", "أنا بشر",
  "لست روبوت", "دخول", "متابعة", "انضم", "نعم", "أوافق",
  "ابدأ", "تأكيد",
];

/**
 * Patterns to extract a required word/phrase from challenge text.
 * Group 1 is the word/phrase to send back.
 */
const TEXT_CHALLENGE_PATTERNS: RegExp[] = [
  // "send/type/write/reply with 'WORD'"
  /(?:send|type|write|reply\s+with|respond\s+with)\s+["'«»]?([a-zA-Z0-9\u0600-\u06FF_\-]{1,30})["'«»]?/i,
  // "the password/word/code is 'WORD'"
  /(?:the\s+)?(?:password|code|word|phrase|كلمة|الكود|الرمز|الرقم|السر)\s+(?:is|هي|هو)\s+["'«»]?([a-zA-Z0-9\u0600-\u06FF_\-]{1,30})["'«»]?/i,
  // "'WORD' to join/verify/enter"
  /["'«»]([a-zA-Z0-9\u0600-\u06FF_\-]{2,20})["'«»]\s+(?:to\s+)?(?:join|verify|enter|access|للدخول|للانضمام|للتحقق)/i,
  // Arabic: "أرسل كلمة WORD" / "اكتب WORD"
  /(?:أرسل|ارسل|اكتب|اضغط\s+كلمة|ابعث|أبعث)\s+["'«»]?([a-zA-Z0-9\u0600-\u06FF_\-]{1,30})["'«»]?/i,
];

/** Detects math expressions like "5 + 3", "12 - 4", "3 × 4", "9 / 3". */
const MATH_PATTERN = /(\d{1,4})\s*([+\-×x\*÷\/])\s*(\d{1,4})/;

/** Detect if text asks the user to send /start. */
const START_PATTERN = /(?:send|type|write|ابعث|أرسل|اكتب)\s+\/start/i;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Evaluate a two-operand arithmetic expression. Returns null on failure. */
function evalMath(a: string, op: string, b: string): number | null {
  const x = parseInt(a, 10);
  const y = parseInt(b, 10);
  if (isNaN(x) || isNaN(y)) return null;
  switch (op) {
    case "+": return x + y;
    case "-": return x - y;
    case "×": case "x": case "*": return x * y;
    case "÷": case "/": return y !== 0 ? Math.floor(x / y) : null;
    default: return null;
  }
}

/**
 * Extract the inline-keyboard button most likely to be a verification button.
 * Returns the button's callback data and display text, or null if none found.
 */
function pickVerifyButton(replyMarkup: any): { data: Buffer | Uint8Array; text: string } | null {
  if (!replyMarkup) return null;

  // mtcute wraps keyboards in different shapes depending on version.
  // Try both .rows (InlineKeyboardMarkup) and .inlineKeyboard.
  const rows: any[] =
    replyMarkup?.rows ??
    replyMarkup?.inlineKeyboard ??
    (Array.isArray(replyMarkup) ? replyMarkup : []);

  if (!Array.isArray(rows) || rows.length === 0) return null;

  // Flatten all buttons into one array
  const allButtons: any[] = [];
  for (const row of rows) {
    const rowBtns: any[] = row?.buttons ?? (Array.isArray(row) ? row : []);
    allButtons.push(...rowBtns);
  }

  // ── Pass 1: prefer buttons whose text matches known verify keywords ─────────
  for (const btn of allButtons) {
    const text = String(btn?.text ?? "").toLowerCase();
    const data: Buffer | Uint8Array | undefined = btn?.data ?? btn?.callbackData;
    if (!data) continue; // skip URL buttons (no callback data)
    if (VERIFY_BUTTON_KEYWORDS.some((kw) => text.includes(kw.toLowerCase()))) {
      return { data, text: btn.text ?? "" };
    }
  }

  // ── Pass 2: fallback — take the first button that has callback data ─────────
  for (const btn of allButtons) {
    const data: Buffer | Uint8Array | undefined = btn?.data ?? btn?.callbackData;
    if (data) return { data, text: btn?.text ?? "" };
  }

  return null;
}

/**
 * Click an inline keyboard button via raw TL `messages.getBotCallbackAnswer`.
 * Returns true on success (including BOT_RESPONSE_TIMEOUT which is normal).
 */
async function clickButton(
  client: TelegramClient,
  chatId: string | number,
  msgId: number,
  data: Buffer | Uint8Array
): Promise<boolean> {
  try {
    const peer = await (client as any).resolvePeer(chatId);
    await (client as any).call({
      _: "messages.getBotCallbackAnswer",
      peer,
      msgId,
      data: Buffer.isBuffer(data) ? data : Buffer.from(data),
      game: false,
    });
    return true;
  } catch (e: any) {
    // BOT_RESPONSE_TIMEOUT is normal — it means we clicked and the bot is just slow
    if (String(e?.message ?? "").includes("BOT_RESPONSE_TIMEOUT")) return true;
    logger.debug({ err: e?.message }, "[VERIFY] clickButton error");
    return false;
  }
}

/**
 * Send a text message to the chat.
 * Tries sendMessage first, falls back to sendText if that API differs.
 */
async function sendText(
  client: TelegramClient,
  chatId: string | number,
  text: string
): Promise<boolean> {
  try {
    if (typeof (client as any).sendMessage === "function") {
      await (client as any).sendMessage(chatId, { text });
      return true;
    }
    throw new Error("no sendMessage");
  } catch {
    try {
      if (typeof (client as any).sendText === "function") {
        await (client as any).sendText(chatId, text);
        return true;
      }
    } catch (e: any) {
      logger.debug({ err: e?.message }, "[VERIFY] sendText fallback error");
    }
  }
  return false;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Run verification challenge detection for a newly joined group.
 *
 * Designed to be called **fire-and-forget** (not awaited) right after the
 * join succeeds, so it runs concurrently with `observeGroupAfterJoin`.
 *
 * @param client   Active TelegramClient for the joining account
 * @param chatId   Numeric ID of the joined group
 * @param url      Original link URL (for logging only)
 * @param phone    Account phone number (for logging only)
 */
export async function handleVerificationChallenge(
  client: TelegramClient,
  chatId: string | number,
  url: string,
  phone: string
): Promise<void> {
  // Give bots a moment to send their welcome/verification message
  await sleep(INITIAL_WAIT_MS);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // ── Fetch recent messages ─────────────────────────────────────────────
      let messages: any[] = [];
      if (typeof (client as any).getMessages === "function") {
        messages = (await (client as any).getMessages(chatId, { limit: MSG_FETCH_LIMIT })) ?? [];
      } else if (typeof (client as any).getHistory === "function") {
        messages = (await (client as any).getHistory(chatId, { limit: MSG_FETCH_LIMIT })) ?? [];
      }
      if (!Array.isArray(messages)) break;

      // ── Scan messages for verification challenges ──────────────────────────
      for (const msg of messages) {
        const msgText: string = String(
          msg?.text ?? msg?.message ?? msg?.content?.text ?? ""
        ).trim();
        const msgId: number = msg?.id ?? msg?.msgId ?? 0;
        const replyMarkup = msg?.replyMarkup ?? msg?.markup;

        if (!msgId) continue;

        // ── Strategy 1: Inline keyboard button ────────────────────────────
        if (replyMarkup) {
          const btn = pickVerifyButton(replyMarkup);
          if (btn) {
            const ok = await clickButton(client, chatId, msgId, btn.data);
            if (ok) {
              logger.info(
                { url, phone, btn: btn.text, attempt },
                "[VERIFY] ✅ Clicked verification button"
              );
              return;
            }
          }
        }

        if (!msgText) continue;

        // ── Strategy 2: /start command ────────────────────────────────────
        if (START_PATTERN.test(msgText) || msgText.toLowerCase().startsWith("/start")) {
          const ok = await sendText(client, chatId, "/start");
          if (ok) {
            logger.info({ url, phone, attempt }, "[VERIFY] ✅ Sent /start command");
            await sleep(2_000);
            return;
          }
        }

        // ── Strategy 3: Text keyword challenge ────────────────────────────
        for (const pattern of TEXT_CHALLENGE_PATTERNS) {
          const match = msgText.match(pattern);
          if (match?.[1]) {
            const answer = match[1].trim();
            const ok = await sendText(client, chatId, answer);
            if (ok) {
              logger.info({ url, phone, answer, attempt }, "[VERIFY] ✅ Sent text challenge answer");
              await sleep(2_000);
              return;
            }
          }
        }

        // ── Strategy 4: Math problem ──────────────────────────────────────
        const mathMatch = msgText.match(MATH_PATTERN);
        if (mathMatch) {
          const result = evalMath(mathMatch[1]!, mathMatch[2]!, mathMatch[3]!);
          if (result !== null) {
            const ok = await sendText(client, chatId, String(result));
            if (ok) {
              logger.info(
                { url, phone, expr: mathMatch[0], result, attempt },
                "[VERIFY] ✅ Solved math verification challenge"
              );
              await sleep(2_000);
              return;
            }
          }
        }
      }

      // No challenge found yet — wait before next attempt
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RECHECK_INTERVAL_MS);
      }
    } catch (e: any) {
      // Access errors (kicked already, restricted, etc.) — stop silently
      const msg = String(e?.message ?? "");
      if (
        msg.includes("CHAT_FORBIDDEN") ||
        msg.includes("USER_NOT_PARTICIPANT") ||
        msg.includes("CHANNEL_PRIVATE")
      ) {
        logger.debug({ url, phone, err: msg }, "[VERIFY] No longer in chat — stopping");
        return;
      }
      logger.debug({ url, phone, err: msg, attempt }, "[VERIFY] Attempt error (non-critical)");
      if (attempt < MAX_ATTEMPTS) await sleep(RECHECK_INTERVAL_MS);
    }
  }

  logger.debug({ url, phone, maxAttempts: MAX_ATTEMPTS }, "[VERIFY] No challenge detected — done");
}
