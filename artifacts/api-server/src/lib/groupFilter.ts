/**
 * GROUP RELEVANCE FILTER
 *
 * The bot is designed to join ONLY medical, research, and educational groups.
 * Filter is applied to the group title (and description if available).
 * If the title is unknown (e.g. private invite link with no preview), we join anyway
 * and trust the source (links should be pre-vetted).
 */

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
  "emergency", "ambulance", "icu", "icu nurse",
  "diabetes", "cancer", "tumor",
  // ===== English: Research/Academic =====
  "research", "science", "scientific", "study",
  "university", "college", "academic", "education",
  "student", "graduate", "phd", "master",
  "lecture", "curriculum", "thesis", "dissertation",
  "med student", "medstudent",
];

// Normalize to lowercase once
const NORMALIZED_KEYWORDS = RELEVANT_KEYWORDS.map((k) => k.toLowerCase());

/**
 * Returns true if the group title/description is relevant (medical/research/educational).
 * Returns true also when both title and description are empty/null (trust the source).
 */
export function isRelevantGroup(
  title: string | null | undefined,
  description?: string | null
): boolean {
  if (!title && !description) return true; // unknown → trust source

  const combined = ((title ?? "") + " " + (description ?? "")).toLowerCase();

  return NORMALIZED_KEYWORDS.some((kw) => combined.includes(kw));
}

/**
 * Categorize the group type string for logging.
 */
export function categorizeChatType(raw: string): "group" | "channel" | "unknown" {
  if (raw.includes("channel")) return "channel";
  if (raw.includes("group") || raw.includes("chat") || raw.includes("supergroup")) return "group";
  return "unknown";
}
