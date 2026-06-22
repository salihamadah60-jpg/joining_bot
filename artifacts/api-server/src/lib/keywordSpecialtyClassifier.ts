/**
 * KEYWORD-BASED SPECIALTY CLASSIFIER — COMPREHENSIVE EDITION
 *
 * Deterministic, zero-API, instant classification of Arabic/English Telegram
 * group names into one of the 8 medical specialties.
 *
 * Used as PRIMARY classifier — AI (Gemini) is only called for items that
 * cannot be determined by keywords alone.
 *
 * Priority order: exams → dentistry → nursing → anesthesia → laboratory
 *                 → pharmacy → general → null (not medical)
 *
 * Also exports classifyGroupConfidence() → 4-tier:
 *   medical | probably_medical | uncertain | non_medical
 */

export type SpecialtyCode =
  | "general" | "dentistry" | "nursing" | "anesthesia"
  | "laboratory" | "pharmacy" | "exams" | "channels_only"
  | null;

export type MedicalConfidence =
  | "medical" | "probably_medical" | "uncertain" | "non_medical";

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

// EXAMS — licensing, board, certification, language, rotation exams (HIGHEST PRIORITY)
const EXAMS: string[] = [
  // ── Saudi / Gulf licensing ──
  "prometric", "smle", "usmle", "scfhs", "dha", "haad", "moh exam",
  "saudi medical", "saudi licensing", "gulf exam",
  "sple", "sdle",                           // Saudi Pharmacy / Dental Licensing Exam
  "شهادة البورد", "اختبار البورد",

  // ── UK / International exams ──
  "plab", "osce", "mrcs", "mrcp", "mrcgp", "mrcem", "mrpch",
  "mrcog", "emrcog", "frcr", "frcs", "frcog", "mrcpsych",
  "drcog", "dfrsh", "diploma rca",
  "fcps", "usmle step", "step 1", "step 2", "step 3",
  "nbme", "nclex", "mlex", "uworld", "amboss",
  "shelf exam", "in-service exam",
  "pastel",                                // French/International licensing
  "inbde", "nbde",                         // Dental licensing
  "naplex", "mpje",                        // Pharmacy licensing

  // ── Arab / Regional board ──
  "البورد العربي", "البورد السعودي", "البورد الخليجي",
  "البورد الأردني", "البورد المصري", "البورد العماني",
  "بورد طب", "بورد الطب", "بورد طبي", "بورد الأطباء",
  "البورد", "ابتعاث للبورد",
  "زمالة طب", "زمالة الطب", "زمالة طبية", "زمالة طبيب",
  "زمالة سعودية", "زمالة عربية", "زمالة خليجية",

  // ── OSCE / OSPE ──
  "أوسكي", "اوسكي", "أوسكى", "اوسكى", "osce",
  "ospe", "clinical skills exam",

  // ── Arabic exam terms ──
  "مرخصين", "مرخص", "ترخيص طبي", "اختبار ترخيص", "امتحان ترخيص",
  "بروماتريك", "بروميتريك",
  "هيئة التخصصات الصحية", "التخصصات الصحية", "هيئة التخصصات",
  "سكرين", "screen exam",
  "التصنيف scfhs", "تصنيف scfhs",
  "السبورة العربية",

  // ── Residency / Fellowship ──
  "residency", "residency match", "residency program",
  "fellowship program", "fellowship training", "icu fellowship",
  "fellowship exam", "هاوس مان", "housemanship",
  "intern match", "internship program", "medical internship",
  "إنترنشيب", "إنترن شيب",

  // ── Rotation ──
  "rotation", "clinical rotation", "surgery rotation", "medical rotation",
  "رأوتيشن", "روتيشن", "روتيشون",

  // ── Diploma ──
  "diploma", "postgraduate diploma", "pgd",
  "دبلوم طبي", "دبلوم التمريض", "دبلوم الصيدلة",
  "دوبلوما", "دبلوم",

  // ── CME / CPD ──
  "cme", "cpd", "continuing medical education", "medical education",
  "تعليم طبي مستمر",

  // ── Language tests for healthcare workers ──
  "goethe", "goethe-zertifikat", "telc",   // German tests (for working in Germany)
  "oet",                                    // Occupational English Test (healthcare)
  "ielts medical", "ielts health",
  "pte medical", "pte health",
  "TestDaF",

  // ── Arabic exam-prep & study groups ──
  "مذاكرة", "مراجعة", "مراجعات", "تحضير امتحان", "تحضير اختبار",
  "بنك أسئلة", "بنك الأسئلة", "أسئلة طبية",
  "ملخص طبي", "ملخصات طبية", "ملاحظات طبية",
  "study group", "revision group", "exam prep", "mcq medical",

  // ── Candidate ──
  "candidate", "exam candidate", "board candidate",
  "مرشح", "متقدم للبورد",
];

// DENTISTRY — dental specialties & subspecialties
const DENTISTRY: string[] = [
  // Arabic
  "أسنان", "اسنان", "الأسنان", "الاسنان",
  "طب الأسنان", "طب الاسنان", "طب أسنان", "طب اسنان",
  "جراحة الأسنان", "جراحة الفم", "تجويف الفم",
  "علاج الجذور", "جذور أسنان", "جذور اسنان", "علاج عصب",
  "زراعة أسنان", "زراعة اسنان", "تركيبات أسنان",
  "لثة", "أمراض اللثة", "تقويم الأسنان", "تقويم اسنان", "تقويم أسنان",
  "تعويض سني", "طب تعويضي", "بروثيز", "اطقم أسنان", "طقم أسنان",
  "مواد سنية", "مواد أسنان", "أشعة أسنان",
  "طب أسنان أطفال", "تخدير أسنان",
  "endodont", "عصب سن",

  // English
  "dental", "dentist", "dentistry", "teeth", "tooth",
  "orthodont", "endodont", "periodont", "prosthodont",
  "oral surgery", "oral health", "oral medicine",
  "maxillofacial", "pedodont", "dental implant",
  "orthodontics", "endodontics", "periodontics",
  "prosthodontics", "pedodontics", "restorative dental",
  "dental hygien", "dental lab", "dental material",
  "dental radiology", "dental public health",
];

// NURSING — all nursing levels, specialties, home care
const NURSING: string[] = [
  // Arabic
  "تمريض", "ممرض", "ممرضة", "التمريض", "تمريضي", "تمريضية",
  "قسم التمريض", "كلية التمريض", "تمريض أطفال", "تمريض نساء",
  "تمريض طوارئ", "تمريض عناية", "تمريض عمليات",
  "رعاية منزلية", "تمريض منزلي",

  // English
  "nursing", "nurse", "nurses", "midwife", "midwifery", "midwives",
  "registered nurse", "rn", "lpn", "home care nursing",
  "home care nurse", "community nursing", "critical care nursing",
  "icu nursing", "nicu nursing", "picu nursing", "er nursing",
  "nursing aide", "clinical nurse",
];

// ANESTHESIA — anesthesia, critical care, pain management
const ANESTHESIA: string[] = [
  // Arabic
  "تخدير", "التخدير",
  "تخدير وإنعاش", "تخدير وانعاش", "قسم التخدير",
  "إنعاش", "انعاش", "الإنعاش", "الانعاش",
  "عناية مركزة", "العناية المركزة",
  "ألم مزمن", "عيادة الألم", "علاج الألم",

  // English
  "anesthesia", "anesthesiology", "anaesthesia", "anaesthetist",
  "anesthesiologist",
  "sedation", "pain management", "pain clinic", "pain medicine",
  "critical care medicine",
];

// LABORATORY — medical labs, pathology, microbiology, biochemistry, blood bank
const LABORATORY: string[] = [
  // Arabic
  "مختبر", "مختبرات", "المختبر الطبي", "مختبر طبي", "علم المختبرات",
  "تحليل مخبري", "تحاليل طبية", "تحليل طبي", "تحاليل مخبرية",
  "فني مختبر", "مختبريون", "مختبرات طبية",
  "علم الأمراض", "باثولوجيا",
  "ميكروبيولوجيا",
  "كيمياء حيوية",
  "هيماتولوجيا", "بنك الدم", "نقل الدم",
  "تشريح مرضي",

  // English
  "pathology", "histopathology", "cytopathology",
  "microbiology", "medical microbiology",
  "biochemistry", "clinical biochemistry",
  "hematology", "haematology", "blood bank", "transfusion medicine",
  "serology", "histology", "cytology", "immunology",
  "lab technician", "clinical lab", "medical lab", "laboratory",
  "medical laboratory", "clinical laboratory",
  "medical technology", "lab technologist",
  "parasitology", "virology", "bacteriology",
];

// PHARMACY — clinical pharmacy, pharmacology, pharmaceutical sciences
const PHARMACY: string[] = [
  // Arabic
  "صيدلة", "الصيدلة", "صيدلي", "صيدلاني", "الصيدلة السريرية",
  "صيدل",
  "دواء", "أدوية", "ادوية", "عقار", "عقاقير", "دوائي",
  "فارماكولوجيا",

  // English
  "pharmacy", "pharmacology", "pharmacist", "pharmaceutical",
  "clinical pharmacy", "dispensing", "drug therapy",
  "pharmacokinetics", "pharmacodynamics",
  "pharmacy technician", "pharmacy practice",
];

// GENERAL — all other clinical medicine (catch-all after specifics)
const GENERAL: string[] = [
  // ── Arabic specialties & subspecialties ──
  "طب عام", "طب باطني", "طب أسرة", "طب العائلة", "طب أسرة",
  "طب طوارئ", "طب وقائي", "طب مجتمع",
  "طب نفسي", "طب الأطفال", "طب النساء", "طب نساء",
  "طبيب", "طبيبة", "دكتور", "دكتورة", "دكاترة", "أطباء",
  "طلاب طب", "طالب طب", "كلية طب",

  // ── Surgery ──
  "جراح", "جراحة", "جراحية",
  "جراحة العظام", "جراحة التجميل", "جراحة الأعصاب",
  "جراحة القلب", "جراحة الصدر", "جراحة البطن",
  "جراحة المسالك", "جراحة العيون", "جراحة الوجه",
  "جراحة الغدد",

  // ── Internal medicine specialties (Arabic) ──
  "استشاري", "استشارية",
  "باطنة", "باطنية", "طب باطني",
  "قلب", "قلبية", "أمراض القلب", "قلب وأوعية", "كارديولوجي",
  "أعصاب", "اعصاب", "عصبية", "نيورولوجي",
  "عظام", "جراحة العظام", "عظام ومفاصل", "أورثوبيديك",
  "نساء وتوليد", "نسائية", "توليد", "ولادة",
  "جلد", "جلدية", "تجميل",
  "عيون", "رمد", "طب عيون",
  "أنف وأذن وحنجرة", "حنجرة", "سمعيات",
  "طوارئ", "إسعاف", "اسعاف",
  "أشعة", "اشعة", "رنين مغناطيسي", "مقطعية", "سونار", "تصوير طبي",
  "أورام", "اورام", "سرطان", "أورام خبيثة", "أونكولوجيا",
  "مسالك بولية", "بولية",
  "نفسي", "نفسية", "صحة نفسية", "طب نفسي", "بسيكياتري",
  "روماتيز", "روماتولوجي", "روماتيزم",
  "كلى", "غسيل كلى", "نفرولوجي",
  "كبد", "كبدي", "أمراض الكبد", "هيباتولوجي",
  "معدة", "هضمي", "جهاز هضمي", "جاسترو",
  "صدر", "رئة", "صدر ورئة", "بولمونولوجي",
  "غدد صماء", "سكري", "إندوكرين",
  "مناعة", "حساسية", "إيمونولوجي",
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
  "عمليات", "غرفة العمليات",
  "إدارة مستشفى", "إدارة صحية",
  "جينات", "وراثة", "علم الجينوم",
  "إرشاد نفسي",
  "طب شرعي",
  "طب الإسعاف", "طب حوادث",
  "طب الشيخوخة", "جيرياتريك",
  "رعاية حرجة", "طب حرج",
  "طب الأقسام",
  "طب النوم",
  "طب الرياضة",
  "طفيليات",

  // ── Broader Arabic medical identifiers ──
  " طبي ", " طبية ", "الطبي", "الطبية",
  " طب ", "الطب ",
  " صحي ", " صحية ", "الصحي", "الصحية",

  // ── English internal medicine & specialties ──
  "internal medicine",
  "family medicine", "family practice", "family doctor", "fm ",
  "emergency medicine", "emergency room", "emergency physician",
  "accident and emergency",
  "intensive care", "critical care",
  "ICU ", " ICU", "NICU", "PICU", "MICU", "SICU", "CCU",
  "cardiology", "cardiac", "cardiologist",
  "electrophysiology", "interventional cardiology",
  "neurology", "neurosurgery", "neurologist",
  "epilepsy", "stroke", "headache",
  "dermatology", "dermatologist",
  "ophthalmology", "optometry", "eye clinic",
  "ENT ", " ENT", "otolaryngolog", "rhinology", "otology",
  "radiology", "radiologist", "imaging", "diagnostic imaging",
  "interventional radiology",
  "oncology", "oncologist", "cancer care",
  "hematology/oncology", "hemato-oncology",
  "urology", "urologist",
  "psychiatry", "psychiatrist", "mental health",
  "psychology", "clinical psychology",
  "orthopedic", "orthopaedic", "orthopedics", "orthopedist",
  "orthopedic surgery", "trauma surgery",
  "gynecology", "obstetrics", "obgyn", "ob/gyn",
  "maternal fetal", "fetal medicine", "perinatology",
  "pediatric", "paediatric", "pediatrics", "neonatology",
  "adolescent medicine",
  "surgery", "surgical", "surgeon",
  "general surgery", "colorectal", "hepatobiliary",
  "bariatric surgery", "minimally invasive",
  "vascular surgery", "plastic surgery", "reconstructive",
  "physiotherapy", "physical therapy", "occupational therapy",
  "speech therapy",
  "hepatology", "nephrology", "pulmonology", "pulmonary",
  "gastroenterology", "rheumatology", "endocrinology",
  "infectious disease", "infection control",
  "allergy", "immunology",
  "palliative care", "hospice",
  "geriatrics", "gerontology",
  "sports medicine", "musculoskeletal",
  "sleep medicine",
  "pain", "palliative",
  "forensic medicine", "medical ethics",
  "medical", "medicine", "physician", "doctor",
  "hospital", "clinic", "clinical",
  "patient care", "healthcare", "health care",
  "mbbs", "mbbch", "md ",
  "ecg", "eeg", "cbc", "mri", "ct scan", "ultrasound",
  "diabetes", "cancer", "tumor", "tumour",
  "hypertension", "cardiovascular",
  "PEM ", " PEM",                 // Pediatric Emergency Medicine
  "IMD ", " IMD", "imd exam",    // Internal Medicine / specialty
  "home care",
  "تلطيفي", "رعاية ملطفة",

  // ── UK Royal College exams (previously missing → false negatives) ──
  "plab",                        // Professional and Linguistic Assessments Board
  "mrcp",                        // Membership of Royal College of Physicians
  "mrcgp",                       // Royal College of General Practitioners
  "mrcem",                       // Royal College of Emergency Medicine
  "mrpch",                       // Royal College of Paediatrics and Child Health
  "mrcpsych",                    // Royal College of Psychiatrists

  // ── Public health / Community health ──
  "public health", "community health",
  "صحة عامة", "الصحة العامة",
  "صحة مجتمع", "صحة المجتمع",
  "community nursing", "public health nursing",
  "تمريض مجتمع", "تمريض مجتمعي",
  "health promotion",

  // ── Microbiology (Arabic) ──
  "احياء دقيقة", "أحياء دقيقة", "الاحياء الدقيقة",

  // ── Medical drugs / pharmacotherapy ──
  "ivermectin", "fenbendazole", "antiparasitic",
  "dosing", "drug dosing",

  // ── Biomedical / allied health ──
  "biomedical", "biomed",
  "health informatics",
  "paramedic", "paramedics",

  // ── Nutrition / Dietetics ──
  "nutrition", "dietitian", "dietetics",
  "تغذية", "أخصائي تغذية",
];

// ── Not-medical override (wins only when NO specialty pattern matched) ─────────
const NOT_MEDICAL: string[] = [
  "crypto", "bitcoin", "ethereum", "blockchain", "nft", "defi",
  "كريبتو", "بيتكوين", "عملة رقمية", "بلوكشين",
  "استثمار", "مستثمر", "تداول", "forex", "بورصة", "ذهب",
  "real estate", "عقارات", "عقار",
  "cooking", "recipe", "طبخ", "وصفة", "مطبخ", "طعام عام",
  "رياضة ترفيهية", "football", "كرة قدم", "basketball",
  "software", "programming", "coding", "developer", "برمجة",
  "هندسة مدنية", "هندسة كيميائية", "هندسة كهربائية", "هندسة ميكانيكية",
  "محاسبة", "accounting", "قانون", "law school", "legal",
  "gaming", "game", "ترفيه", "موسيقى",
  "منصة استثمار", "ارباح سريعة",
  "ازياء", "موضة", "fashion",
  "تجميل شعر", "حلاقة",
];

// ── SOFT MEDICAL indicators (not enough alone → "probably_medical") ───────────
// These patterns suggest medical context without definitive specialty keywords.
const SOFT_MEDICAL: string[] = [
  // Saudi & Gulf cities (common in medical group names)
  "جدة", "جده", "jeddah", "jedda",
  "الرياض", "riyadh",
  "الخبر", "khobar", "al-khobar",
  "دمام", "dammam",
  "مكة", "مكه", "mecca",
  "المدينة المنورة", "madinah", "medina",
  "الباحة", "albaha", "al baha",
  "أبها", "abha",
  "تبوك", "tabuk",
  "حائل", "hail",
  "القصيم", "qassim", "buraidah",
  "الطائف", "taif",
  "نجران", "najran",
  "جازان", "jizan",
  "ينبع", "yanbu",
  "عسير", "aseer",
  "جوف", "al jouf",
  "شرقية", "eastern province",
  "الإمارات", "دبي", "أبوظبي", "دبي", "الكويت", "البحرين", "عمان", "قطر",

  // Year numbers common in medical exam prep groups
  "2024", "2025", "2026", "2027",

  // Arabic months (used in exam schedule groups)
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
  "محرم", "صفر", "ربيع الأول", "ربيع الثاني",
  "جمادى", "رجب", "شعبان", "رمضان", "شوال", "ذي القعدة", "ذي الحجة",

  // English months (in medical exam group names)
  "january", "february", "march", "april", "june", "july",
  "august", "september", "october", "november", "december",
  "jan ", "feb ", "mar ", "apr ", "jun ", "jul ", "aug ",
  "sep ", "oct ", "nov ", "dec ",

  // Generic terms often paired with medical context
  "student", "students", "طالب", "طلاب",
  "intern ", "interns",
  "candidate", "candidates",
  "rotation ",
  "ielts", "oet", "pte", "goethe",

  // General health terms without specific specialty
  "health", "صحة", "wellbeing", "wellness",
  "clinic", "hospital",
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
 * 4-tier classification for display in left groups / history pages.
 *   medical          — keyword classifier matched a specialty
 *   probably_medical — soft indicators present (city, year, month, etc.)
 *   uncertain        — no title or no match at all
 *   non_medical      — explicit non-medical patterns AND no medical match
 */
export function classifyGroupConfidence(
  title: string | null | undefined,
  url?: string | null
): MedicalConfidence {
  const raw = ((title ?? "") + " " + extractUrlSlug(url)).trim();

  // No content → uncertain
  if (!raw || raw.length < 2) return "uncertain";

  const text = raw.toLowerCase();

  // Definitely medical (specialty matched)
  const specialty = classifyByKeywords(title, url);
  if (specialty !== null) return "medical";

  // Definitely non-medical
  if (
    containsAny(text, NOT_MEDICAL) &&
    !containsAny(text, ["طب", "medical", "pharmacy", "nursing", "clinical", "hospital", "dentist"])
  ) {
    return "non_medical";
  }

  // Soft / probable medical
  if (containsAny(text, SOFT_MEDICAL)) return "probably_medical";

  return "uncertain";
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
