/**
 * GROUP RELEVANCE FILTER
 *
 * The bot is designed to join ONLY medical, research, and educational groups.
 * Filter is applied to the group title (and description if available).
 *
 * ALL keyword lists are imported from medicalKeywords.ts — the single source
 * of truth. Never add keywords here directly; add them there instead.
 *
 * TWO-TIER KEYWORD SYSTEM:
 *   Tier 1 — STRONG_MEDICAL: specific medical terms → sufficient alone to mark RELEVANT
 *   Tier 2 — ACADEMIC_ONLY: generic academic terms (university, college, research, etc.)
 *                            → NOT sufficient alone (too many false positives like
 *                              "كلية الهندسة", "بحث تسويق", "جامعة شقراء")
 *
 * Return values from isRelevantGroupAsync:
 *   true  → clearly relevant (join, keep)
 *   false → clearly NOT relevant (mark not_in_scope / auto-leave)
 *   null  → uncertain (no title + no AI + no messages → pending_review)
 */

import { logger } from "./logger.js";
import { aiClassifyGroup, isAiFilterEnabled } from "./aiFilter.js";
import { collections } from "@workspace/db";
import type { TelegramClient } from "@mtcute/node";
import {
  STRONG_MEDICAL_KEYWORDS,
  HARD_BLOCKED_KEYWORDS,
  ACADEMIC_ONLY_KEYWORDS,
  NORMALIZED_STRONG,
  NORMALIZED_HARD_BLOCKED,
  NORMALIZED_ACADEMIC,
  getCustomKeywords,
} from "./medicalKeywords.js";

/**
 * Post-join observation delay (3–10 seconds, random).
 * Simulates a human reading messages after joining.
 * Returns up to 8 recent message texts for the AI classifier.
 */
export async function observeGroupAfterJoin(
  client: TelegramClient,
  chatId: string | number,
  url: string
): Promise<string[]> {
  const delaySec = 3 + Math.floor(Math.random() * 8);
  await sleep(delaySec * 1000);

  const sampleMessages: string[] = [];
  try {
    let history: any[] | null = null;

    if (typeof (client as any).getMessages === "function") {
      history = await (client as any).getMessages(chatId, { limit: 8 });
    } else if (typeof (client as any).getHistory === "function") {
      history = await (client as any).getHistory(chatId, { limit: 8 });
    }

    if (Array.isArray(history)) {
      for (const msg of history) {
        const text: string | undefined =
          msg?.text ?? msg?.message ?? msg?.content?.text ?? msg?.content;
        if (text && typeof text === "string" && text.trim().length > 5) {
          sampleMessages.push(text.trim().substring(0, 200));
        }
      }
    }
  } catch {
    logger.debug({ url }, "Could not read group history (restricted) — skipping");
  }
  return sampleMessages;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check user-learned patterns first (from previous approve/reject decisions).
 * Returns true (relevant) / false (not relevant) / null (no learned pattern found).
 */
async function checkLearnedPatterns(
  title: string | null | undefined,
  sampleMessages: string[]
): Promise<boolean | null> {
  if (!title && sampleMessages.length === 0) return null;

  try {
    const col = await collections.learnedPatterns();
    const patterns = await col.find({}).toArray();

    const combined = ((title ?? "") + " " + sampleMessages.join(" ")).toLowerCase();

    for (const pattern of patterns) {
      if (
        pattern.keywords &&
        Array.isArray(pattern.keywords) &&
        pattern.keywords.some((kw: string) => combined.includes(kw.toLowerCase()))
      ) {
        logger.debug({ title, decision: pattern.decision }, "Matched learned pattern");
        return pattern.decision === "relevant";
      }
    }
  } catch {
    // collections.learnedPatterns might not exist yet — ignore
  }
  return null;
}

// ─── Word-boundary keyword matching ──────────────────────────────────────────
/**
 * Test if a keyword matches in text using word boundaries (Unicode-aware).
 * Prevents short words like "ME" from matching inside "medicine" or "prometric".
 * Works for both Latin and Arabic text.
 */
function matchesWordBoundary(text: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    const regex = new RegExp(
      `(?<![\\w\\u0600-\\u06FF])${escaped}(?![\\w\\u0600-\\u06FF])`,
      "i"
    );
    return regex.test(text);
  } catch {
    return text.toLowerCase().includes(keyword.toLowerCase());
  }
}

// ─── Custom blocked keywords cache ───────────────────────────────────────────
// Loaded from MongoDB settings (key: "custom_blocked_keywords") with a 60s TTL.

let _customBlockedCache: string[] = [];
let _customBlockedCacheTime = 0;
const CUSTOM_BLOCKED_TTL = 60_000;

export async function getCustomBlockedKeywords(): Promise<string[]> {
  if (Date.now() - _customBlockedCacheTime < CUSTOM_BLOCKED_TTL) {
    return _customBlockedCache;
  }
  try {
    const { getSettings } = await import("@workspace/db");
    const kv = await getSettings();
    const raw = kv["custom_blocked_keywords"];
    _customBlockedCache = raw ? JSON.parse(String(raw)) : [];
    _customBlockedCacheTime = Date.now();
  } catch {
    // keep stale cache on error
  }
  return _customBlockedCache;
}

export function invalidateCustomBlockedCache(): void {
  _customBlockedCacheTime = 0;
}

/**
 * 3-state async relevance check.
 *   true  → keep (relevant)
 *   false → not in scope
 *   null  → uncertain → pending_review
 *
 * Priority: hard-block → custom-block → learned patterns → keywords → AI → uncertain
 */
export async function isRelevantGroupAsync(
  title: string | null | undefined,
  description?: string | null,
  sampleMessages: string[] = []
): Promise<boolean | null> {
  // 0. Hard-block check — static list + runtime custom hard_blocked keywords
  const customKw = getCustomKeywords();
  if (customKw.hard_blocked.length > 0) {
    const combined = ((title ?? "") + " " + (description ?? "") + " " + sampleMessages.join(" ")).toLowerCase();
    if (customKw.hard_blocked.some((kw) => combined.includes(kw))) {
      logger.info({ title }, "Group blocked by custom hard_blocked keyword — skipping");
      return false;
    }
  }
  if (isHardBlocked(title, description, sampleMessages)) {
    logger.info({ title }, "Group hard-blocked (static list) — skipping");
    return false;
  }

  // 0b. Custom blocked keywords (user-defined via Settings UI)
  const customBlocked = await getCustomBlockedKeywords();
  if (customBlocked.length > 0) {
    const combined = (
      (title ?? "") + " " + (description ?? "") + " " + sampleMessages.join(" ")
    );
    const matchedKw = customBlocked.find((kw) => matchesWordBoundary(combined, kw));
    if (matchedKw) {
      logger.info({ title, keyword: matchedKw }, "Group blocked by custom keyword (word-boundary) — skipping");
      return false;
    }
  }

  // 1. Check learned patterns (user-confirmed decisions)
  const learned = await checkLearnedPatterns(title, sampleMessages);
  if (learned !== null) return learned;

  // 2. No info at all → uncertain (pending_review)
  if (!title && !description && sampleMessages.length === 0) return null;

  // 3. KEYWORD CHECK — static + custom strong_medical → runs BEFORE AI.
  const kwResult = isRelevantGroup(title, description);
  if (kwResult) return true;
  // Check custom strong_medical keywords added via Keywords Manager
  if (customKw.strong_medical.length > 0) {
    const combined = ((title ?? "") + " " + (description ?? "")).toLowerCase();
    if (customKw.strong_medical.some((kw) => combined.includes(kw))) return true;
  }

  // 4. Try AI classification (only for groups that keywords couldn't confirm as medical)
  if (isAiFilterEnabled()) {
    const aiResult = await aiClassifyGroup(title, sampleMessages);
    if (aiResult !== null) return aiResult;
    return null;
  }

  // 5. Keyword-only path (AI disabled): keywords returned false → not in scope
  return false;
}

// ─── Hard block check ─────────────────────────────────────────────────────────

export function isHardBlocked(
  title: string | null | undefined,
  description?: string | null,
  sampleMessages: string[] = []
): boolean {
  const combined = (
    (title ?? "") + " " + (description ?? "") + " " + sampleMessages.join(" ")
  ).toLowerCase();
  return NORMALIZED_HARD_BLOCKED.some((kw) => combined.includes(kw));
}

// ─── Two-tier keyword relevance check (synchronous) ──────────────────────────

/**
 * Two-tier keyword relevance check (synchronous).
 *
 * Returns true  → strong medical keyword match
 * Returns false → no strong medical keyword
 */
export function isRelevantGroup(
  title: string | null | undefined,
  description?: string | null
): boolean {
  if (isHardBlocked(title, description)) return false;
  if (!title && !description) return true; // no info → let async handler decide

  const combined = ((title ?? "") + " " + (description ?? "")).toLowerCase();

  // Tier 1: specific medical keyword → RELEVANT
  if (NORMALIZED_STRONG.some((kw) => combined.includes(kw))) return true;

  return false;
}

/**
 * Quick synchronous medical check — used for UI pre-classification.
 * Returns: "medical" | "non_medical" | "uncertain"
 */
export function classifyGroupQuick(
  title: string | null | undefined,
  description?: string | null
): "medical" | "non_medical" | "uncertain" {
  if (!title && !description) return "uncertain";
  if (isHardBlocked(title, description)) return "non_medical";

  const combined = ((title ?? "") + " " + (description ?? "")).toLowerCase();
  if (NORMALIZED_STRONG.some((kw) => combined.includes(kw))) return "medical";

  // Has some academic keywords but no medical → not medical
  if (NORMALIZED_ACADEMIC.some((kw) => combined.includes(kw))) return "non_medical";

  return "uncertain";
}

/**
 * Categorize the group type string for logging.
 */
export function categorizeChatType(raw: string): "group" | "channel" | "unknown" {
  const lower = raw.toLowerCase();
  if (lower.includes("channel")) return "channel";
  if (lower.includes("group") || lower.includes("chat") || lower.includes("supergroup")) return "group";
  return "unknown";
}

// Re-export for consumers that previously imported these directly from groupFilter
export { STRONG_MEDICAL_KEYWORDS, HARD_BLOCKED_KEYWORDS, ACADEMIC_ONLY_KEYWORDS };
