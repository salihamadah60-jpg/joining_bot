/**
 * KEYWORD-BASED SPECIALTY CLASSIFIER
 *
 * Deterministic, zero-API, instant classification of Arabic/English Telegram
 * group names into one of the 8 medical specialties.
 *
 * Used as PRIMARY classifier — AI (Gemini) is only called for items that
 * cannot be determined by keywords alone.
 *
 * Priority order: exams → dentistry → nursing → anesthesia → laboratory
 *                 → pharmacy → general → null (not medical)
 */

export type SpecialtyCode =
  | "general" | "dentistry" | "nursing" | "anesthesia"
  | "laboratory" | "pharmacy" | "exams" | "channels_only"
  | null;

// ─── URL slug extractor ───────────────────────────────────────────────────────

function extractUrlSlug(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const m = url.match(/t\.me\/([^/+?#\s]{3,})/i);
    if (m && m[1]) return m[1].replace(/[_\-]/g, " ").toLowerCase();
  } catch {}
  return "";
}

// ─── Pattern lists (checked as case-insensitive substrings) ───────────────────

// EXAMS — licensing, board, certification exams (highest priority — most specific)
const EXAMS: string[] = [
  // Known exam names / acronyms
  "prometric", "smle", "usmle", "scfhs", "dha", "haad", "osce", "mrcs",
  "frcr", "plab", "mrcog", "fcps", "mrcp", "nclex", "nbme", "mlex",
  "uworld", "amboss",
  // Arabic exam terms
  "ابتعاث", "بورد طب", "بورد الطب", "بورد طبي", "بورد الأطباء",
  "زمالة طب", "زمالة الطب", "زمالة طبية", "زمالة طبيب",
  "مرخصين", "مرخص", "ترخيص طبي", "اختبار ترخيص", "امتحان ترخيص",
  "بروماتريك", "بروميتريك",
  "امتحان smle", "امتحان scfhs", "امتحان prometric", "امتحان dha",
  "التصنيف scfhs", "تصنيف scfhs",
  "هيئة التخصصات الصحية", "التخصصات الصحية", "هيئة التخصصات",
  "السبورة العربية",
  "سكرين", "screen exam",
  // English exam terms
  "board exam", "medical board", "medical license", "medical licensing",
  "licensing exam", "fellowship program", "residency match",
  "step 1", "step 2", "step 3", "usmle step",
  "shelf exam", "in-service exam",
];

// DENTISTRY — dental specialties
const DENTISTRY: string[] = [
  "أسنان", "اسنان",
  "طب الأسنان", "طب الاسنان", "طب أسنان", "طب اسنان",
  "dental", "dentist", "dentistry", "teeth",
  "orthodont", "endodont", "periodont", "prosthodont",
  "جراحة الفم", "oral surgery", "oral health",
  "علاج الجذور", "جذور أسنان", "جذور اسنان",
  "زراعة أسنان", "زراعة اسنان",
  "لثة", "تقويم الأسنان", "تقويم اسنان", "تقويم أسنان",
  "تعويض سني", "اطقم أسنان", "اطقم اسنان",
];

// NURSING
const NURSING: string[] = [
  "تمريض", "ممرض", "ممرضة", "التمريض", "تمريضي", "تمريضية",
  "قسم التمريض", "كلية التمريض",
  "nursing", "nurse", "nurses", "midwife", "midwifery",
];

// ANESTHESIA
const ANESTHESIA: string[] = [
  "تخدير", "التخدير",
  "تخدير وإنعاش", "تخدير وانعاش", "قسم التخدير",
  "إنعاش", "انعاش", "الإنعاش", "الانعاش",
  "anesthesia", "anesthesiology", "anaesthesia", "anaesthetist",
  "sedation", "pain management", "pain clinic", "pain medicine",
  "ألم مزمن", "عيادة الألم",
];

// LABORATORY — medical labs, pathology, micro, biochem
const LABORATORY: string[] = [
  "مختبر", "مختبرات", "المختبر الطبي", "مختبر طبي", "علم المختبرات",
  "تحليل مخبري", "تحاليل طبية", "تحليل طبي", "تحاليل مخبرية",
  "فني مختبر", "مختبريون",
  "علم الأمراض", "باثولوجيا", "pathology",
  "ميكروبيولوجيا", "microbiology",
  "كيمياء حيوية", "biochemistry",
  "هيماتولوجيا", "hematology", "haematology",
  "serology", "histology", "cytology",
  "lab technician", "clinical lab", "medical lab", "laboratory",
  "medical laboratory",
];

// PHARMACY
const PHARMACY: string[] = [
  "صيدلة", "الصيدلة", "صيدلي", "صيدلاني", "الصيدلة السريرية",
  "صيدل",
  "دواء", "أدوية", "ادوية", "عقار", "عقاقير", "دوائي",
  "pharmacy", "pharmacology", "pharmacist", "pharmaceutical",
  "clinical pharmacy", "dispensing",
];

// GENERAL — all other clinical medicine (catch-all after specifics)
const GENERAL: string[] = [
  // Arabic clinical specialties
  "طب عام", "طب باطني", "طب أسرة", "طب طوارئ", "طب وقائي", "طب مجتمع",
  "طب نفسي", "طب الأطفال", "طب النساء",
  "طبيب", "طبيبة", "دكتور", "دكتورة", "دكاترة", "أطباء",
  "طلاب طب", "طالب طب",
  "جراح", "جراحة", "جراحية",
  "استشاري", "استشارية",
  "باطنة", "باطنية", "طب باطني",
  "قلب", "قلبية", "أمراض القلب", "قلب وأوعية",
  "أعصاب", "اعصاب", "عصبية",
  "عظام", "جراحة العظام", "إصابات ملاعب",
  "نساء وتوليد", "نسائية", "توليد", "ولادة",
  "جلد", "جلدية", "تجميل",
  "عيون", "رمد",
  "أنف وأذن وحنجرة",
  "طوارئ", "إسعاف", "اسعاف",
  "أشعة", "اشعة", "رنين مغناطيسي", "مقطعية", "سونار",
  "أورام", "اورام", "سرطان", "أورام خبيثة",
  "مسالك بولية", "بولية",
  "نفسي", "نفسية", "صحة نفسية",
  "روماتيز", "روماتولوجي",
  "كلى", "غسيل كلى",
  "كبد", "كبدي", "أمراض الكبد",
  "معدة", "هضمي", "جهاز هضمي",
  "صدر", "رئة", "صدر ورئة",
  "غدد صماء", "سكري",
  "مناعة", "حساسية",
  "فيزيوثيرابي", "علاج طبيعي", "تأهيل طبي",
  "بصريات",
  "ترميز طبي",
  "PCT", "CSSD",
  "فني طبي", "مساعد طبيب",
  "تشريح", "فسيولوجيا",
  "كلية الطب", "قسم الطب",
  "مستشفى", "مستشفيات",
  "عيادة", "عيادات",
  "وظائف طبية", "وظائف صحية", "وظائف تمريض",
  "مقابلات طبية", "مقابلات فني",
  "صحة مهنية",
  // Broader Arabic medical identifiers
  " طبي ", " طبية ", "الطبي", "الطبية",
  " طب ", "الطب ",
  " صحي ", " صحية ", "الصحي", "الصحية",
  // English clinical terms
  "internal medicine", "family medicine", "emergency medicine",
  "intensive care", "critical care",
  "ICU", "NICU", "PICU",
  "cardiology", "cardiac",
  "neurology", "neurosurgery",
  "dermatology",
  "ophthalmology",
  "radiology", "radiologist",
  "oncology",
  "urology",
  "psychiatry", "psychology",
  "orthopedic", "orthopaedic",
  "gynecology", "obstetrics",
  "pediatric", "paediatric",
  "surgery", "surgical", "surgeon",
  "physiotherapy", "physical therapy",
  "optometry",
  "hepatology", "nephrology", "pulmonology",
  "gastroenterology", "rheumatology", "endocrinology",
  "immunology",
  "medical", "medicine", "physician", "doctor",
  "hospital", "clinic", "clinical",
  "patient care", "healthcare", "health care",
  "mbbs", "mbbch",
  "ecg", "eeg", "cbc",
  "diabetes", "cancer", "tumor", "tumour",
];

// ─── Not-medical override (wins only when NO specialty pattern matched) ─────
const NOT_MEDICAL: string[] = [
  "crypto", "bitcoin", "ethereum", "blockchain", "nft",
  "كريبتو", "بيتكوين", "عملة رقمية", "بلوكشين",
  "استثمار", "مستثمر", "تداول", "forex", "بورصة",
  "real estate", "عقارات",
  "cooking", "recipe", "طبخ", "وصفة", "مطبخ",
  "رياضة", "football", "كرة قدم", "basketball",
  "software", "programming", "coding", "developer",
  "هندسة مدنية", "هندسة كيميائية", "هندسة كهربائية", "هندسة ميكانيكية",
  "محاسبة", "accounting", "قانون", "law",
  "gaming", "game", "ترفيه", "موسيقى",
  "منصة استثمار", "ارباح سريعة",
];

// ─── Core matcher ─────────────────────────────────────────────────────────────

function containsAny(text: string, patterns: string[]): boolean {
  for (const p of patterns) {
    if (text.includes(p.toLowerCase())) return true;
  }
  return false;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Classify a single group title+url into a medical specialty.
 * Returns null if not medical or unrecognizable.
 *
 * This function is SYNCHRONOUS and requires NO API calls.
 */
export function classifyByKeywords(
  title: string | null | undefined,
  url?: string | null
): Exclude<SpecialtyCode, "channels_only"> {
  const slug = extractUrlSlug(url);
  const raw = ((title ?? "") + " " + slug).trim();
  if (!raw) return null;
  const text = raw.toLowerCase();

  // Hard override: known non-medical signals
  // (only disqualify if the title itself is clearly non-medical)
  if (containsAny(text, NOT_MEDICAL) && !containsAny(text, [
    "طب", "medical", "pharmacy", "nursing", "clinical", "hospital",
    "dentist", "laborator",
  ])) {
    return null;
  }

  // Priority classification
  if (containsAny(text, EXAMS))      return "exams";
  if (containsAny(text, DENTISTRY))  return "dentistry";
  if (containsAny(text, NURSING))    return "nursing";
  if (containsAny(text, ANESTHESIA)) return "anesthesia";
  if (containsAny(text, LABORATORY)) return "laboratory";
  if (containsAny(text, PHARMACY))   return "pharmacy";
  if (containsAny(text, GENERAL))    return "general";

  return null;
}

/**
 * Classify a batch of items synchronously (no API, instant).
 * Same signature as classifySpecialtyBatch for easy swapping.
 */
export function classifyBatchByKeywords(
  items: Array<{ title?: string | null; url?: string | null }>
): Array<Exclude<SpecialtyCode, "channels_only">> {
  return items.map((item) => classifyByKeywords(item.title, item.url));
}

/**
 * Is this title medical at all? (quick yes/no — no specialty determination)
 */
export function isMedicalByKeywords(
  title: string | null | undefined,
  url?: string | null
): boolean {
  return classifyByKeywords(title, url) !== null;
}
