/**
 * GROUP RELEVANCE FILTER
 *
 * The bot is designed to join ONLY medical, research, and educational groups.
 * Filter is applied to the group title (and description if available).
 *
 * Return values from isRelevantGroupAsync:
 *   true  → clearly relevant (join, keep)
 *   false → clearly NOT relevant (mark not_in_scope)
 *   null  → uncertain (no title + no AI + no messages → pending_review)
 *
 * Learning: checks learnedPatterns collection for user-confirmed decisions
 * before running AI/keyword classification.
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
    // Try different @mtcute history methods
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

/**
 * 3-state async relevance check.
 *   true  → keep (relevant)
 *   false → not in scope
 *   null  → uncertain → pending_review
 *
 * Priority: learned patterns → AI → keywords → uncertain
 */
export async function isRelevantGroupAsync(
  title: string | null | undefined,
  description?: string | null,
  sampleMessages: string[] = []
): Promise<boolean | null> {
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
    // but if keywords don't match clearly, return null (uncertain)
    const kwResult = isRelevantGroup(title, description);
    if (!kwResult) {
      // AI unavailable + keywords say "no" → uncertain, needs human review
      return null;
    }
    return kwResult;
  }

  // 4. Keyword-only (no AI)
  return isRelevantGroup(title, description);
}

const RELEVANT_KEYWORDS = [
  // ===== Arabic: Medical =====
  "طب", "طبيب", "أطباء", "اطباء", "طبية",
  "صيدل", "صيدلي", "صيدلان", "صيدلانيات",
  "مستشف", "مستشفى", "عيادة", "عيادات",
  "صحة", "صحي", "صحية",
  "تمريض", "ممرض", "ممرضة",
  "جراح", "جراحة",
  "أشعة", "اشعة", "مختبر", "مختبرات",
  "تحليل", "تحاليل",
  "دواء", "أدوية", "ادوية", "علاج", "علاجات",
  "مريض", "مرضى",
  "أسنان", "اسنان", "تقويم",
  "بصريات", "نظارات",
  "فيزيوثيرابي", "تأهيل", "تاهيل",
  "نفسي", "نفسية",
  "قلب", "قلبية",
  "أعصاب", "اعصاب", "عصبية",
  "باطنة", "باطنية",
  "جلدية",
  "عظام", "عظمية",
  "أطفال", "اطفال",
  "نساء وتوليد", "توليد",
  "ميكروب", "بكتيريا", "فيروس", "مناعة",
  "أشعة سينية", "مقطعية", "رنين مغناطيسي",
  "تشريح", "فسيولوجيا", "كيمياء حيوية",
  "باثولوجيا", "هيستولوجيا",
  "طوارئ", "إسعاف", "اسعاف",
  "كلى", "كليه", "غسيل كلى",
  "سكري", "ضغط الدم", "أورام", "اورام", "سرطان",
  // ===== Arabic: Research/Academic =====
  "بحث", "بحثي", "بحثية", "أبحاث", "ابحاث",
  "علمي", "علمية",
  "دراسة", "دراسات",
  "جامعة", "جامعات",
  "كلية", "كليات",
  "أكاديم", "اكاديم", "أكاديمي", "اكاديمي",
  "تعليم", "تعليمي", "تعليمية",
  "طلاب", "طالب", "طالبات",
  "تخرج", "خريج",
  "دكتوراه", "ماجستير", "بكالوريوس",
  "مقرر", "محاضرة", "محاضرات",
  "مناهج", "امتحان", "اختبار",
  "ملزمة", "مذكرة", "ملاحظات طبية",
  "الكلية", "القسم الطبي",
  "طب بشري", "طب بيطري",
  // ===== English: Medical =====
  "medical", "medicine", "doctor", "doctors", "physician",
  "health", "healthcare", "pharmacy", "pharmacist",
  "nursing", "nurse", "surgery", "surgical",
  "hospital", "clinic", "radiology", "laboratory",
  "treatment", "therapy", "diagnosis", "patient",
  "dental", "dentist", "optometry",
  "cardiology", "neurology", "dermatology", "oncology",
  "pediatric", "gynecology", "psychiatry", "orthopedic",
  "anatomy", "physiology", "biochemistry", "pathology",
  "emergency", "ambulance", "icu",
  "diabetes", "cancer", "tumor",
  // ===== English: Research/Academic =====
  "research", "science", "scientific", "study",
  "university", "college", "academic", "education",
  "student", "graduate", "phd", "master",
  "lecture", "curriculum", "thesis", "dissertation",
  "med student", "medstudent",
  // ===== Student/Scholarship keywords (added for common group names) =====
  "students", "scholarship", "scholarships", "admission", "admissions",
  "طلاب الخارج", "ابتعاث", "منح", "دراسة الخارج",
];

const NORMALIZED_KEYWORDS = RELEVANT_KEYWORDS.map((k) => k.toLowerCase());

/**
 * Returns true if the group title/description is relevant.
 * Returns false when title/description exist but no keywords match.
 */
export function isRelevantGroup(
  title: string | null | undefined,
  description?: string | null
): boolean {
  if (!title && !description) return true;
  const combined = ((title ?? "") + " " + (description ?? "")).toLowerCase();
  return NORMALIZED_KEYWORDS.some((kw) => combined.includes(kw));
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
