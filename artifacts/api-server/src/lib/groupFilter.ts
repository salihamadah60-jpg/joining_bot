/**
 * GROUP RELEVANCE FILTER
 *
 * The bot is designed to join ONLY medical, research, and educational groups.
 * Filter is applied to the group title (and description if available).
 *
 * TWO-TIER KEYWORD SYSTEM:
 *   Tier 1 — STRONG_MEDICAL: specific medical terms → sufficient alone to mark RELEVANT
 *   Tier 2 — ACADEMIC_ONLY:  generic academic terms (university, college, research, etc.)
 *                             → NOT sufficient alone (too many false positives like
 *                               "كلية الهندسة", "بحث تسويق", "جامعة شقراء")
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
  // Escape regex special chars in the keyword
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    // Unicode-aware word boundary: not preceded or followed by a word char (Latin or Arabic)
    const regex = new RegExp(
      `(?<![\\w\\u0600-\\u06FF])${escaped}(?![\\w\\u0600-\\u06FF])`,
      "i"
    );
    return regex.test(text);
  } catch {
    // Fallback: substring match if regex fails (e.g. complex Unicode edge case)
    return text.toLowerCase().includes(keyword.toLowerCase());
  }
}

// ─── Custom blocked keywords cache ───────────────────────────────────────────
// Loaded from MongoDB settings (key: "custom_blocked_keywords") with a 60s TTL.
// This lets admins add/remove keywords from the UI without restarting the server.

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
 * Priority: hard-block → custom-block → learned patterns → AI → keywords → uncertain
 */
export async function isRelevantGroupAsync(
  title: string | null | undefined,
  description?: string | null,
  sampleMessages: string[] = []
): Promise<boolean | null> {
  // 0. Hard-block check — investment/crypto/ads/excuses → always reject immediately
  if (isHardBlocked(title, description, sampleMessages)) {
    logger.info({ title }, "Group hard-blocked (static list) — skipping");
    return false;
  }

  // 0b. Custom blocked keywords (user-defined via Settings UI)
  // Uses word-boundary matching to avoid false positives:
  // e.g. "ME" should NOT block "medicine", "prometric", "MRCP", "SMLE", "USMLE"
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

  // 3. Try AI classification
  if (isAiFilterEnabled()) {
    const aiResult = await aiClassifyGroup(title, sampleMessages);
    if (aiResult !== null) return aiResult;
    // AI returned null (unavailable/error) — fall through to keywords
    const kwResult = isRelevantGroup(title, description);
    if (!kwResult) return null;
    return kwResult;
  }

  // 4. Keyword-only (no AI)
  return isRelevantGroup(title, description);
}

/**
 * HARD-BLOCKED keywords — groups matching ANY of these are ALWAYS rejected,
 * regardless of AI or learned patterns.
 */
const HARD_BLOCKED_KEYWORDS = [
  // ── Medical excuse / fraud groups (NOT medical education) ──────────────────
  // "اعذار طبية/طبيه" = groups about writing medical excuse notes (fraud)
  // "سكليف" / "sickleave" = excuse-note group name patterns (Arabic & English)
  "سكليف", "سكاليف",
  "sickleave", "sick leave", "sick_leave",
  "اعذار طبية", "اعذار طبيه", "الاعذار الطبية", "الاعذار الطبيه",
  "عذر طبي", "عذر طبيه",
  // ── Non-medical student-services academies ─────────────────────────────────
  // "خدمات طلابية" = student administrative services, not medical education
  "خدمات طلابية", "الخدمات الطلابية",
  // ── Arabic: Investment / Finance ───────────────────────────────────────────
  "استثمار", "استثمارات", "مستثمر", "مستثمرين", "للمستثمرين",
  "عملات رقمية", "عملة رقمية",
  "كريبتو", "كريبتوا",
  "بيتكوين",
  "بلوكشين", "بلوك شين",
  "اكتتاب", "أكتتاب", "اكتتابات", "أكتتابات",
  "فوركس",
  "مضاربة",
  "امبات", "أمبات",
  "كابيتال",
  "توصيات تداول", "توصيات الاسهم", "توصيات الفوركس",
  "ربح سريع", "ارباح سريعة", "تربح من",
  "منصة",
  // English: Crypto / Investment
  "crypto", "cryptocurrency",
  "bitcoin", "btc", "ethereum", "eth", "usdt", "solana",
  "blockchain",
  "forex",
  "ipo", "ico", "nft",
  "trading signals", "signals",
  "investment opportunity",
];

const NORMALIZED_BLOCKED = HARD_BLOCKED_KEYWORDS.map((k) => k.toLowerCase());

export function isHardBlocked(
  title: string | null | undefined,
  description?: string | null,
  sampleMessages: string[] = []
): boolean {
  const combined = (
    (title ?? "") + " " + (description ?? "") + " " + sampleMessages.join(" ")
  ).toLowerCase();
  return NORMALIZED_BLOCKED.some((kw) => combined.includes(kw));
}

// ─── TIER 1: Strong medical keywords — sufficient alone ───────────────────────
// These are SPECIFIC to medicine/healthcare. A group with ANY of these is relevant.

const STRONG_MEDICAL_KEYWORDS = [
  // ── Arabic: Medical specialties & professions ──
  "طب", "طبيب", "طبية", "أطباء", "اطباء",
  "طب بشري", "طب بيطري", "طب أسنان", "طب اسنان",
  "كلية الطب",             // medical school (explicit)
  "قسم الطب",
  "صيدل", "صيدلي", "صيدلانيات",
  "تمريض", "ممرض", "ممرضة",
  "جراح", "جراحة",
  "أسنان", "اسنان", "أسنانية",
  "بصريات",
  "فيزيوثيرابي", "علاج طبيعي",
  "نفسية", "نفسي",          // psychiatry/psychology
  "قلبية", "أمراض قلب",
  "أعصاب", "اعصاب", "عصبية",
  "باطنة", "باطنية",
  "جلدية",
  "عظام", "عظمية", "تجبير",
  "نساء وتوليد", "توليد", "ولادة",
  "أطفال وحديثي", "حديثي الولادة",
  "مختبر", "مختبرات", "مختبر طبي",
  "أشعة", "اشعة",
  "أورام", "اورام", "سرطان", "أورام",
  "طوارئ طبية", "إسعاف", "اسعاف",
  "كلى", "غسيل كلى",
  "سكري", "ضغط الدم", "ضغط دم",
  "تشريح", "فسيولوجيا", "كيمياء حيوية", "باثولوجيا", "هيستولوجيا",
  "ميكروبيولوجيا", "مناعة",
  "مقطعية", "رنين مغناطيسي", "أشعة سينية",
  "تخدير",
  "عناية مركزة", "رعاية حرجة",
  "دواء", "أدوية", "ادوية", "علاج",
  "مريض", "مرضى",
  "عيادة", "مستشفى", "مستشفيات",
  // ── Arabic: Medical technicians (فني roles common in Saudi healthcare) ──
  "رعاية مرضى",             // patient care technician (PCT)
  "تعقيم",                  // CSSD / sterilization technician
  "ترميز طبي", "ترميز",     // medical coding
  "فني طبي",
  "مساعد طبيب",
  "فني مختبر",
  "فني أشعة",
  "التشغيل العلاجي",
  // ── Arabic: Saudi healthcare exams & certifications ──
  "ستيب", "STEP",
  "هيئة التخصصات",
  "الهيئة السعودية للتخصصات",
  "برامج الهيئة",
  "تخصصات صحية", "التخصصات الصحية",
  "برامج صحية",
  "مقابلات فني",             // technician program interviews
  "مقابلات طبية",
  "الكليات الصحية",
  "بروماتريك",              // Prometric
  "اختبار هيئة",            // commission exam
  "اختبار ترخيص",           // license exam
  "صحة مهنية",
  "السبورة العربية",         // Arabic Board
  // ── Arabic: Medical jobs ──
  "وظائف طبية", "وظائف صحية", "وظائف تمريض", "وظائف صيدل",
  "وظائف أشعة", "وظائف مختبر",
  "توظيف طبي",
  // ── English: Medical specialties ──
  "medical", "medicine", "doctor", "physician",
  "pharmacy", "pharmacist",
  "nursing", "nurse",
  "surgery", "surgical",
  "hospital", "clinic",
  "radiology", "laboratory",
  "treatment", "therapy", "diagnosis", "patient",
  "dental", "dentist", "orthodontic",
  "optometry", "ophthalmology",
  "cardiology", "neurology", "dermatology", "oncology",
  "pediatric", "gynecology", "obstetric",
  "psychiatry", "orthopedic",
  "anatomy", "physiology", "biochemistry", "pathology",
  "microbiology", "immunology",
  "emergency", "ambulance", "icu",
  "diabetes", "cancer", "tumor",
  "anesthesia",
  // ── English: Saudi healthcare acronyms ──
  "pct",     // patient care technician
  "cssd",    // central sterile supply department
  "scfhs",   // saudi commission for health specialties
  "ecg", "eeg",
  "smle",    // saudi medical licensing exam
  "dha",     // dubai health authority exam
  "prometric",
  "mrcog",   // membership of royal college of obstetricians
  "sple",    // saudi pharmacy license exam
  "osce",    // objective structured clinical examination
  "nbme",    // national board of medical examiners
  "mrcs",    // membership of royal college of surgeons
  "frcr",    // fellow of royal college of radiologists
  "cbc",     // complete blood count
  // ── Pharmacy / clinical ──
  "pharmacology", "pharmaceutical",
  // ── Health specialties keywords (common in Saudi group naming) ──
  "health specialties", "health sciences",
];

const NORMALIZED_STRONG = STRONG_MEDICAL_KEYWORDS.map((k) => k.toLowerCase());

// ─── TIER 2: Academic-only keywords — NOT sufficient alone ─────────────────────
// These appear in many non-medical groups. Used only to CONFIRM non-relevance
// when NO strong medical keyword is present.

const ACADEMIC_ONLY_KEYWORDS = [
  "جامعة", "جامعات",
  "كلية",                // college (of engineering, law, etc.)
  "طلاب", "طالب", "طالبات",
  "دراسة", "دراسات",
  "تعليم", "تعليمي", "تعليمية",
  "أكاديم", "اكاديم",
  "بحث", "بحثية", "أبحاث", "ابحاث",
  "علمي", "علمية",
  "تخرج", "خريج", "خريجين",
  "دكتوراه", "ماجستير", "بكالوريوس",
  "مقرر", "محاضرة", "محاضرات",
  "مناهج", "امتحان", "اختبار",
  "ملزمة", "مذكرة",
  "ابتعاث", "منح دراسية", "منح",
  "طلاب الخارج", "دراسة الخارج",
  "university", "college", "academic", "academics",
  "research", "science", "scientific",
  "study", "studies",
  "student", "students", "graduate",
  "phd", "master", "bachelor",
  "lecture", "curriculum", "thesis", "dissertation",
  "scholarship", "scholarships", "admission",
];

const NORMALIZED_ACADEMIC = ACADEMIC_ONLY_KEYWORDS.map((k) => k.toLowerCase());

/**
 * Two-tier keyword relevance check (synchronous).
 *
 * Returns true  → strong medical keyword match
 * Returns false → no strong medical keyword (either academic-only or nothing)
 * (Never returns null — that's for the async wrapper when truly uncertain)
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

  // Tier 2: only generic academic keywords (university, research, study…)
  // without any medical signal → NOT RELEVANT
  // (e.g. "كلية الهندسة", "جامعة شقراء", "Applied Statistics", "SHAGHAF RESEARCH")
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

  // No recognizable keywords at all → uncertain
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
