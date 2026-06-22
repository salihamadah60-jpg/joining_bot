/**
 * MEDICAL KEYWORDS — SINGLE SOURCE OF TRUTH
 *
 * This file is the ONLY place where keyword lists are defined.
 * All other files (groupFilter, keywordSpecialtyClassifier, aiFilter,
 * leaveEngine, requeue logic) MUST import from here.
 *
 * Design rules:
 *   1. Every specialty includes ALL morphological derivatives
 *      (dentist → dentists, dentistry, dental, dentine, dentin…)
 *   2. Arabic words include all vowel/spelling variants
 *      (أسنان ↔ اسنان, ممرض ↔ ممرضة ↔ ممرضين ↔ ممرضات…)
 *   3. Additions here automatically propagate to:
 *      - Join-time filter  (groupFilter → isRelevantGroupAsync)
 *      - Post-join filter  (groupFilter → isRelevantGroupAsync)
 *      - AI system prompt  (aiFilter → SYSTEM_PROMPT)
 *      - Leave cleanup     (leaveEngine → autoCleanupAccount)
 *      - Requeue skipped   (links route → requeueSkippedFromHistory)
 */

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — SPECIALTY KEYWORD LISTS
// Used by keywordSpecialtyClassifier for specialty tagging.
// Priority order: EXAMS → DENTISTRY → NURSING → ANESTHESIA
//                 → LABORATORY → PHARMACY → GENERAL → null
// ─────────────────────────────────────────────────────────────────────────────

// ── EXAMS ────────────────────────────────────────────────────────────────────
export const EXAMS_KEYWORDS: string[] = [
  // Saudi / Gulf licensing
  "prometric", "prometricx", "promatric", "prometrick",
  "بروماتريك", "بروميتريك", "برومتريك", "بروماتريك",
  "smle", "usmle", "scfhs", "dha", "haad", "moh exam",
  "saudi medical", "saudi licensing", "gulf exam",
  "sple", "sdle",
  "شهادة البورد", "اختبار البورد",

  // UK / International exams
  "plab", "osce", "ospe",
  "mrcs", "mrcp", "mrcgp", "mrcem", "mrpch",
  "mrcog", "emrcog", "frcr", "frcs", "frcog", "mrcpsych",
  "drcog", "dfrsh", "diploma rca",
  "fcps", "usmle step", "step 1", "step 2", "step 3",
  "nbme", "nclex", "mlex", "uworld", "amboss",
  "shelf exam", "in-service exam",
  "pastel",
  "inbde", "nbde",
  "naplex", "mpje",
  "clinical skills exam",

  // Arab / Regional board
  "البورد العربي", "البورد السعودي", "البورد الخليجي",
  "البورد الأردني", "البورد المصري", "البورد العماني",
  "بورد طب", "بورد الطب", "بورد طبي", "بورد الأطباء",
  "البورد", "ابتعاث للبورد",
  "زمالة طب", "زمالة الطب", "زمالة طبية", "زمالة طبيب",
  "زمالة سعودية", "زمالة عربية", "زمالة خليجية",
  "السبورة العربية",

  // OSCE / OSPE Arabic
  "أوسكي", "اوسكي", "أوسكى", "اوسكى",

  // Arabic exam terms
  "مرخصين", "مرخص", "ترخيص طبي", "اختبار ترخيص", "امتحان ترخيص",
  "هيئة التخصصات الصحية", "التخصصات الصحية", "هيئة التخصصات",
  "الهيئة السعودية للتخصصات",
  "سكرين", "screen exam",
  "التصنيف scfhs", "تصنيف scfhs",
  "اختبار هيئة",

  // Residency / Fellowship
  "residency", "residency match", "residency program",
  "fellowship program", "fellowship training", "icu fellowship",
  "fellowship exam", "هاوس مان", "housemanship",
  "intern match", "internship program", "medical internship",
  "إنترنشيب", "إنترن شيب", "انترنشيب",

  // Rotation
  "rotation", "clinical rotation", "surgery rotation", "medical rotation",
  "رأوتيشن", "روتيشن", "روتيشون",

  // Diploma
  "postgraduate diploma", "pgd",
  "دبلوم طبي", "دبلوم التمريض", "دبلوم الصيدلة",
  "دوبلوما",

  // CME / CPD
  "cme", "cpd", "continuing medical education", "medical education",
  "تعليم طبي مستمر",

  // Language tests for healthcare workers
  "goethe", "goethe-zertifikat", "telc",
  "oet",
  "ielts medical", "ielts health",
  "pte medical", "pte health",
  "testdaf",

  // Arabic exam-prep & study groups
  "مذاكرة", "مراجعة", "مراجعات", "تحضير امتحان", "تحضير اختبار",
  "بنك أسئلة", "بنك الأسئلة", "أسئلة طبية", "أسئلة دراسية",
  "ملخص طبي", "ملخصات طبية", "ملاحظات طبية",
  "study group", "revision group", "exam prep", "mcq medical",

  // Candidate
  "candidate", "exam candidate", "board candidate",
  "مرشح", "متقدم للبورد",
];

// ── DENTISTRY ────────────────────────────────────────────────────────────────
export const DENTISTRY_KEYWORDS: string[] = [
  // English root + all derivatives
  "dental", "dentist", "dentists", "dentistry", "dentine", "dentin",
  "dentition", "dentinal", "dentinogenesis",

  // Ortho family
  "orthodontic", "orthodontics", "orthodontist", "orthodontists",
  "orthodontology", "ortho dental", "ortho teeth",

  // Endo family
  "endodontic", "endodontics", "endodontist", "endodontists",
  "endodontology", "root canal", "root canal treatment", "rct",
  "endodont",

  // Perio family
  "periodontic", "periodontics", "periodontist", "periodontists",
  "periodontology", "periodontal", "periodont",
  "gingival", "gingivitis", "periodontitis",

  // Prostho family
  "prosthodontic", "prosthodontics", "prosthodontist", "prosthodontists",
  "prosthodontology", "prosthodont",
  "dental prosthesis", "dental prosthetics", "dentures", "denture",
  "crown", "bridge", "implant prosthetics",

  // Pedo family
  "pedodontic", "pedodontics", "pedodontist", "pedodontists",
  "paedodontic", "paedodontics",
  "dental pediatrics", "pediatric dentistry", "paediatric dentistry",
  "pedodont",

  // Oral surgery / medicine
  "oral surgery", "oral surgeon", "oral surgeons",
  "oral medicine", "oral health", "oral hygiene", "oral care",
  "oral radiology", "oral pathology", "oral biology",
  "orofacial", "oromaxillary",

  // Maxillofacial
  "maxillofacial", "maxillofacial surgery", "maxillofacial surgeon",
  "craniofacial", "facial surgery",

  // Implant
  "dental implant", "dental implants", "implantology",
  "زراعة أسنان", "زراعة الأسنان", "زراعة اسنان",

  // Other English dental terms
  "teeth", "tooth", "toothache",
  "dental hygien", "dental hygienist", "dental hygienists",
  "dental lab", "dental laboratory", "dental material", "dental materials",
  "dental radiology", "dental public health",
  "dental nurse", "dental assistant", "dental therapist",
  "occlusion", "malocclusion", "braces",
  "composite", "amalgam", "veneer", "veneers",
  "bleaching teeth", "teeth whitening",
  "tmj", "temporomandibular",

  // Arabic root + all derivatives
  "أسنان", "اسنان", "الأسنان", "الاسنان",
  "سن", "السن", "الأسنانية", "سنية", "سني",
  "طب الأسنان", "طب الاسنان", "طب أسنان", "طب اسنان",
  "كلية طب الأسنان", "قسم طب الأسنان",
  "جراحة الأسنان", "جراحة الفم", "تجويف الفم",
  "علاج الجذور", "جذور أسنان", "جذور اسنان", "علاج عصب", "عصب سن",
  "تركيبات أسنان", "تركيبات سنية",
  "لثة", "أمراض اللثة", "اللثة",
  "تقويم الأسنان", "تقويم اسنان", "تقويم أسنان", "تقويم سني",
  "تعويض سني", "طب تعويضي", "بروثيز", "اطقم أسنان", "طقم أسنان", "طواقم",
  "مواد سنية", "مواد أسنان", "أشعة أسنان",
  "طب أسنان أطفال", "تخدير أسنان",
  "حشو أسنان", "حشوات",
  "طبيب أسنان", "طبيبة أسنان", "دكتور أسنان", "دكتورة أسنان",
  "طلاب أسنان", "طالب أسنان",
  "فم وأسنان",
];

// ── NURSING ───────────────────────────────────────────────────────────────────
export const NURSING_KEYWORDS: string[] = [
  // English root + all derivatives
  "nursing", "nurse", "nurses", "nursed",
  "nursery care",

  // Midwifery family
  "midwife", "midwives", "midwifery", "midwife practice",

  // Nurse titles/types
  "registered nurse", "registered nurses",
  "rn ", " rn", "lpn", "cna", "bsn", "msn", "aprn",
  "nurse practitioner", "nurse practitioners",
  "clinical nurse specialist", "clinical nurse",
  "charge nurse", "staff nurse", "head nurse", "chief nurse",
  "nurse manager", "nurse educator", "nurse leader",

  // Nursing specialties
  "icu nursing", "icu nurse", "icu nurses",
  "nicu nursing", "nicu nurse",
  "picu nursing", "picu nurse",
  "er nursing", "er nurse", "emergency nurse", "emergency nursing",
  "critical care nursing", "critical care nurse",
  "pediatric nursing", "pediatric nurse",
  "obstetric nursing", "obstetric nurse", "maternity nursing",
  "community nursing", "community nurse",
  "home care nursing", "home care nurse",
  "oncology nursing", "oncology nurse",
  "psychiatric nursing", "mental health nursing",
  "surgical nursing", "operating room nurse", "scrub nurse",
  "anesthesia nursing", "nurse anesthetist",
  "dialysis nursing", "renal nursing",
  "geriatric nursing",
  "nursing aide", "nursing assistant",

  // Nursing education
  "nursing school", "nursing college", "nursing faculty",
  "nursing student", "nursing students",
  "nclex", "nursing exam", "nursing license",

  // Arabic root + all derivatives
  "تمريض", "التمريض", "تمريضي", "تمريضية",
  "ممرض", "ممرضة", "ممرضين", "ممرضات", "المرضة",
  "مرضة", "مريضة",
  "التمريضية", "القبالة",
  "قسم التمريض", "كلية التمريض", "قسم تمريض",
  "تمريض أطفال", "تمريض نساء", "تمريض نسائية",
  "تمريض طوارئ", "تمريض عناية", "تمريض عمليات",
  "رعاية منزلية", "تمريض منزلي",
  "تمريض مجتمع", "تمريض مجتمعي",
  "تمريض حرجة", "تمريض حرج",
  "تمريض الولادة", "تمريض توليد",
  "فني تمريض", "فنيي تمريض",
  "طالب تمريض", "طلاب تمريض",
  "طالبة تمريض", "طالبات تمريض",
  "وظائف تمريض", "وظيفة تمريض",
  "ليسانس تمريض", "بكالوريوس تمريض",
  "دكتور تمريض", "دكتورة تمريض",
  "القبالة",
];

// ── ANESTHESIA ────────────────────────────────────────────────────────────────
export const ANESTHESIA_KEYWORDS: string[] = [
  // English root + all derivatives
  "anesthesia", "anesthesiology", "anesthesiologist", "anesthesiologists",
  "anesthetist", "anesthetists", "anesthetics",
  "anaesthesia", "anaesthesiology", "anaesthesiologist",
  "anaesthetist", "anaesthetists",
  "analgesia", "analgesic",
  "sedation", "sedative",

  // Critical care
  "critical care medicine", "critical care specialist",
  "intensivist", "intensivists",
  "icu medicine",

  // Pain medicine
  "pain management", "pain medicine", "pain specialist",
  "pain clinic", "chronic pain", "acute pain",
  "pain anesthesia",
  "regional anesthesia", "epidural", "spinal anesthesia",
  "nerve block", "local anesthesia",
  "general anesthesia",

  // Arabic root + all derivatives
  "تخدير", "التخدير", "تخديري", "تخديرية",
  "أخصائي تخدير", "أخصائية تخدير",
  "طبيب تخدير", "طبيبة تخدير", "دكتور تخدير",
  "تخدير وإنعاش", "تخدير وانعاش",
  "قسم التخدير", "قسم تخدير",
  "إنعاش", "انعاش", "الإنعاش", "الانعاش",
  "عناية مركزة", "العناية المركزة",
  "العناية الحرجة", "رعاية حرجة", "الرعاية الحرجة",
  "وحدة العناية", "طب حرج",
  "ألم مزمن", "عيادة الألم", "علاج الألم", "أمراض الألم",
  "أدارة الألم",
  "مسكن", "مسكنات", "بنج",
  "طالب تخدير", "طلاب تخدير",
];

// ── LABORATORY ────────────────────────────────────────────────────────────────
export const LABORATORY_KEYWORDS: string[] = [
  // English root + all derivatives
  "laboratory", "laboratories",
  "lab technician", "lab technicians", "lab technologist", "lab technologists",
  "clinical lab", "medical lab", "medical laboratory", "clinical laboratory",

  // Pathology family
  "pathology", "pathologist", "pathologists",
  "histopathology", "histopathologist",
  "cytopathology", "cytopathologist",
  "anatomical pathology", "anatomic pathology",
  "forensic pathology",
  "neuropathology",

  // Microbiology family
  "microbiology", "microbiologist", "microbiologists",
  "medical microbiology", "clinical microbiology",
  "bacteriology", "bacteriologist",
  "virology", "virologist",
  "parasitology", "parasitologist",
  "mycology",

  // Biochemistry family
  "biochemistry", "biochemist", "biochemists",
  "clinical biochemistry", "medical biochemistry",

  // Hematology / Blood
  "hematology", "hematologist", "hematologists",
  "haematology", "haematologist",
  "blood bank", "blood banking", "transfusion medicine",
  "hematopathology",

  // Histology / Cytology
  "histology", "histologist",
  "cytology", "cytologist",
  "immunohistochemistry",

  // Immunology / Serology
  "immunology", "immunologist",
  "serology", "serologist",
  "clinical immunology",

  // Medical technology
  "medical technology", "medical technologist", "medical technologists",
  "medical laboratory science",
  "laboratory science",
  "laboratory medicine",

  // Arabic root + all derivatives
  "مختبر", "مختبرات", "المختبر الطبي", "مختبر طبي",
  "علم المختبرات", "مختبرات طبية",
  "تحليل مخبري", "تحاليل طبية", "تحليل طبي", "تحاليل مخبرية",
  "تحليلات مخبرية", "تحاليل",
  "فني مختبر", "فنيو مختبر", "أخصائي مختبر", "أخصائية مختبر",
  "مختبريون", "مختبريات",
  "علم الأمراض", "باثولوجيا", "أمراض نسيجية",
  "ميكروبيولوجيا", "علم الجراثيم",
  "كيمياء حيوية", "الكيمياء الحيوية",
  "هيماتولوجيا", "بنك الدم", "نقل الدم",
  "تشريح مرضي", "تشريح السرطان",
  "علم المناعة", "المناعة",
  "بكتيريا", "بكتريولوجيا",
  "فيروسات", "فيروسولوجيا",
  "طفيليات",
  "هيستولوجيا", "هستولوجيا",
  "مصل", "مصليات",
  "طالب مختبر", "طلاب مختبر",
];

// ── PHARMACY ─────────────────────────────────────────────────────────────────
export const PHARMACY_KEYWORDS: string[] = [
  // English root + all derivatives
  "pharmacy", "pharmacies",
  "pharmacist", "pharmacists",
  "pharmaceutical", "pharmaceuticals", "pharmaceutics",
  "pharmacology", "pharmacologist", "pharmacologists",
  "pharmacokinetics", "pharmacodynamics",
  "pharmacotherapy",
  "pharmacy technician", "pharmacy technicians",
  "pharmacy practice", "clinical pharmacy",
  "dispensary", "dispensing", "dispensation",
  "drug therapy", "drug store",
  "compounding", "medication",
  "hospital pharmacy", "community pharmacy",
  "industrial pharmacy",
  "pharmacy student", "pharmacy students",
  "pharmacy school", "college of pharmacy",

  // Arabic root + all derivatives
  "صيدلة", "الصيدلة", "الصيدلية",
  "صيدلي", "صيدلاني", "صيدليون", "صيادلة",
  "صيدلانية", "صيدلانيون",
  "الصيدلة السريرية", "صيدلة سريرية",
  "صيدل",
  "دواء", "أدوية", "ادوية", "الدواء",
  "عقار", "عقاقير", "العقار",
  "دوائي", "دوائية",
  "فارماكولوجيا", "الفارماكولوجيا",
  "عيادة الصيدلة",
  "صيدلية", "صيدليات",
  "فني صيدلة", "أخصائي صيدلة",
  "طالب صيدلة", "طلاب صيدلة",
  "طالبة صيدلة", "طالبات صيدلة",
  "كلية الصيدلة", "قسم الصيدلة",
  "وظائف صيدلة", "وظيفة صيدلة",
  "رخصة صيدلاني",
  "الدراسة الصيدلانية",
];

// ── GENERAL MEDICINE ──────────────────────────────────────────────────────────
export const GENERAL_KEYWORDS: string[] = [
  // ── Medical professions (English) ──
  "medical", "medicine", "physician", "physicians",
  "doctor", "doctors",
  "mbbs", "mbbch", "md ", " md,",
  "clinical", "clinician", "clinicians",
  "hospital", "hospitals", "clinic", "clinics",
  "patient", "patients", "patient care",
  "healthcare", "health care", "health system",

  // ── Specialties (English) ──
  "internal medicine",
  "family medicine", "family practice", "family doctor",
  "emergency medicine", "emergency room", "emergency physician",
  "accident and emergency",
  "intensive care",
  "ICU ", " ICU", "NICU", "PICU", "MICU", "SICU", "CCU",
  "cardiology", "cardiologist", "cardiac",
  "electrophysiology", "interventional cardiology",
  "neurology", "neurologist", "neurosurgery", "neurosurgeon",
  "epilepsy", "stroke", "headache",
  "dermatology", "dermatologist",
  "ophthalmology", "ophthalmologist", "optometry", "optometrist",
  "eye clinic", "eye care",
  "ENT ", " ENT", "otolaryngolog", "rhinology", "otology",
  "radiology", "radiologist", "diagnostic imaging", "imaging",
  "interventional radiology",
  "oncology", "oncologist", "cancer care", "hematology/oncology",
  "urology", "urologist",
  "psychiatry", "psychiatrist", "mental health",
  "psychology", "clinical psychology", "psychologist",
  "orthopedic", "orthopaedic", "orthopedics", "orthopedist",
  "orthopedic surgery", "trauma surgery",
  "gynecology", "gynaecology", "obstetrics", "obgyn", "ob/gyn",
  "maternal fetal", "fetal medicine", "perinatology",
  "pediatric", "paediatric", "pediatrics", "neonatology",
  "adolescent medicine",
  "surgery", "surgical", "surgeon", "surgeons",
  "general surgery", "colorectal", "hepatobiliary",
  "bariatric surgery", "minimally invasive",
  "vascular surgery", "plastic surgery", "reconstructive",
  "physiotherapy", "physical therapy", "physical therapist",
  "occupational therapy", "occupational therapist",
  "speech therapy", "speech therapist",
  "hepatology", "nephrology", "pulmonology", "pulmonary",
  "gastroenterology", "gastroenterologist",
  "rheumatology", "rheumatologist",
  "endocrinology", "endocrinologist",
  "infectious disease", "infection control",
  "allergy", "allergist", "immunology",
  "palliative care", "hospice",
  "geriatrics", "gerontology", "geriatrician",
  "sports medicine", "musculoskeletal",
  "sleep medicine",
  "forensic medicine", "medical ethics",
  "home care",

  // ── Diagnostics / procedures (English) ──
  "ecg", "eeg", "cbc", "mri", "ct scan", "ultrasound",
  "diabetes", "cancer", "tumor", "tumour",
  "hypertension", "cardiovascular",
  "PEM ", " PEM",
  "IMD ", " IMD",

  // ── Allied health / Biomedical (English) ──
  "physiotherapy", "physical therapy",
  "optometry", "bصريات",
  "medical coding", "ترميز طبي",
  "pct", "cssd",
  "paramedic", "paramedics",
  "biomedical", "biomed",
  "health informatics",
  "nutrition", "dietitian", "dietetics",
  "radiographer", "radiography",
  "pharmacist",

  // ── Public / Community health (English) ──
  "public health", "community health",
  "community nursing", "public health nursing",
  "health promotion",

  // ── Saudi healthcare acronyms ──
  "scfhs", "smle", "dha", "prometric",
  "mrcog", "sple", "osce", "nbme", "mrcs", "frcr",

  // ── Arabic: Medical professions ──
  "طبيب", "طبيبة", "الطبيب", "الطبيبة",
  "أطباء", "اطباء", "الأطباء",
  "دكتور", "دكتورة", "دكاترة",
  "طبي", "طبية", "الطبي", "الطبية",
  " طب ", "الطب ", " طب", "طب ",
  "طب بشري", "طب بيطري",
  "كلية الطب", "كلية طب", "قسم الطب", "قسم طب",
  "طلاب طب", "طالب طب", "طالبة طب", "طالبات طب",

  // ── Arabic: Specialties ──
  "طب عام", "طب باطني", "طب الباطنة",
  "طب أسرة", "طب العائلة",
  "طب طوارئ", "طب وقائي", "طب مجتمع",
  "طب نفسي", "طب الأطفال", "طب النساء", "طب نساء",
  "استشاري", "استشارية",
  "باطنة", "باطنية",
  "قلب", "قلبية", "أمراض القلب", "قلب وأوعية", "كارديولوجي",
  "أعصاب", "اعصاب", "عصبية", "نيورولوجي",
  "عظام", "عظمية", "عظام ومفاصل", "أورثوبيديك",
  "جراحة العظام",
  "نساء وتوليد", "نسائية", "توليد", "ولادة", "قسم الولادة",
  "جلد", "جلدية",
  "عيون", "رمد", "طب عيون",
  "أنف وأذن وحنجرة", "حنجرة", "سمعيات", "أنف وأذن",
  "طوارئ", "إسعاف", "اسعاف",
  "أشعة", "اشعة", "رنين مغناطيسي", "مقطعية", "سونار", "تصوير طبي",
  "أورام", "اورام", "سرطان", "أورام خبيثة", "أونكولوجيا",
  "مسالك بولية", "بولية",
  "نفسي", "نفسية", "صحة نفسية",
  "بسيكياتري",
  "روماتيز", "روماتولوجي", "روماتيزم",
  "كلى", "غسيل كلى", "نفرولوجي",
  "كبد", "كبدي", "أمراض الكبد", "هيباتولوجي",
  "معدة", "هضمي", "جهاز هضمي", "جاسترو",
  "صدر", "رئة", "صدر ورئة", "بولمونولوجي",
  "غدد صماء", "سكري", "إندوكرين",
  "مناعة", "حساسية", "إيمونولوجي",
  "فيزيوثيرابي", "علاج طبيعي", "تأهيل طبي",
  "بصريات",
  "ترميز طبي", "ترميز",
  "فني طبي", "مساعد طبيب",
  "فني مختبر", "فني أشعة",
  "التشغيل العلاجي",

  // ── Arabic: Surgery ──
  "جراح", "جراحة", "جراحية",
  "جراحة العظام", "جراحة التجميل", "جراحة الأعصاب",
  "جراحة القلب", "جراحة الصدر", "جراحة البطن",
  "جراحة المسالك", "جراحة العيون", "جراحة الوجه",
  "جراحة الغدد",

  // ── Arabic: Organs & systems ──
  "تشريح", "فسيولوجيا", "كيمياء حيوية",
  "هيستولوجيا", "باثولوجيا",
  "ميكروبيولوجيا", "مناعة",
  "مقطعية", "رنين مغناطيسي", "أشعة سينية",
  "مريض", "مرضى", "المريض", "المرضى",
  "عيادة", "عيادات", "مستشفى", "مستشفيات",
  "رعاية مرضى",
  "تعقيم",

  // ── Arabic: Saudi healthcare roles ──
  "ستيب", "STEP",
  "هيئة التخصصات",
  "تخصصات صحية", "التخصصات الصحية",
  "برامج صحية", "برامج الهيئة",
  "مقابلات فني", "مقابلات طبية",
  "الكليات الصحية",
  "صحة مهنية",

  // ── Arabic: Medical jobs ──
  "وظائف طبية", "وظائف صحية", "وظائف أشعة", "وظائف مختبر",
  "توظيف طبي",

  // ── Arabic: Public / Community health ──
  "صحة عامة", "الصحة العامة",
  "صحة مجتمع", "صحة المجتمع",
  "تمريض مجتمع", "تمريض مجتمعي",
  "احياء دقيقة", "أحياء دقيقة", "الاحياء الدقيقة",

  // ── Arabic: Specific medical conditions / terms ──
  "سكري", "ضغط الدم", "ضغط دم",
  "دواء", "أدوية", "ادوية", "علاج",
  "عمليات", "غرفة العمليات",
  "إدارة مستشفى", "إدارة صحية",
  "جينات", "وراثة", "علم الجينوم",
  "طب شرعي",
  "طب الإسعاف", "طب حوادث",
  "طب الشيخوخة", "جيرياتريك",
  "طب النوم", "طب الرياضة",
  "طفيليات",

  // ── Arabic: Broader medical identifiers ──
  " طبي ", " طبية ", "الطبي", "الطبية",
  " صحي ", " صحية ", "الصحي", "الصحية",
  "صحة", "الصحة",

  // ── Medical drugs / pharmacotherapy ──
  "ivermectin", "fenbendazole", "antiparasitic",
  "dosing", "drug dosing",

  // ── Nutrition / Dietetics ──
  "تغذية", "أخصائي تغذية",

  // ── Palliative ──
  "تلطيفي", "رعاية ملطفة", "palliative",
];

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — RELEVANCE FILTER KEYWORDS
// Used by groupFilter for the two-tier relevance check.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TIER 1 — STRONG MEDICAL: ANY of these is sufficient to mark a group as RELEVANT.
 * Includes all specialty keywords merged into one flat array.
 */
export const STRONG_MEDICAL_KEYWORDS: string[] = [
  ...EXAMS_KEYWORDS,
  ...DENTISTRY_KEYWORDS,
  ...NURSING_KEYWORDS,
  ...ANESTHESIA_KEYWORDS,
  ...LABORATORY_KEYWORDS,
  ...PHARMACY_KEYWORDS,
  ...GENERAL_KEYWORDS,
];

/**
 * TIER 2 — ACADEMIC ONLY: Generic academic terms that are NOT sufficient alone.
 * Only used to confirm non-relevance when no strong medical keyword is present.
 */
export const ACADEMIC_ONLY_KEYWORDS: string[] = [
  "جامعة", "جامعات",
  "كلية",
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

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — HARD BLOCK LIST
// Groups matching ANY of these are ALWAYS rejected immediately.
// ─────────────────────────────────────────────────────────────────────────────

export const HARD_BLOCKED_KEYWORDS: string[] = [
  // Medical excuse / fraud groups
  "سكليف", "سكاليف",
  "sickleave", "sick leave", "sick_leave",
  "اعذار طبية", "اعذار طبيه", "الاعذار الطبية", "الاعذار الطبيه",
  "عذر طبي", "عذر طبيه",
  // Non-medical student services
  "خدمات طلابية", "الخدمات الطلابية",
  // Investment / Finance (Arabic)
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
  // Crypto / Investment (English)
  "crypto", "cryptocurrency",
  "bitcoin", "btc", "ethereum", "eth", "usdt", "solana",
  "blockchain",
  "forex",
  "ipo", "ico", "nft",
  "trading signals", "signals",
  "investment opportunity",
];

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — SOFT MEDICAL INDICATORS
// Suggest medical context but are NOT sufficient alone → "probably_medical".
// ─────────────────────────────────────────────────────────────────────────────

export const SOFT_MEDICAL_KEYWORDS: string[] = [
  // Saudi & Gulf cities
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
  "الإمارات", "دبي", "أبوظبي", "الكويت", "البحرين", "عمان", "قطر",

  // Year numbers common in medical exam prep groups
  "2024", "2025", "2026", "2027",

  // Arabic months
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
  "محرم", "صفر", "ربيع الأول", "ربيع الثاني",
  "جمادى", "رجب", "شعبان", "رمضان", "شوال", "ذي القعدة", "ذي الحجة",

  // English months
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

  // General health terms
  "health", "صحة", "wellbeing", "wellness",
  "clinic", "hospital",
];

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — NOT-MEDICAL OVERRIDE
// Wins only when NO specialty pattern matched at all.
// ─────────────────────────────────────────────────────────────────────────────

export const NOT_MEDICAL_KEYWORDS: string[] = [
  "crypto", "bitcoin", "ethereum", "blockchain", "nft", "defi",
  "كريبتو", "بيتكوين", "عملة رقمية", "بلوكشين",
  "استثمار", "مستثمر", "تداول", "forex", "بورصة",
  "real estate", "عقارات", "عقار",
  "cooking", "recipe", "طبخ", "وصفة", "مطبخ",
  "رياضة ترفيهية", "football", "كرة قدم", "basketball",
  "software", "programming", "coding", "developer", "برمجة",
  "هندسة مدنية", "هندسة كيميائية", "هندسة كهربائية", "هندسة ميكانيكية",
  "محاسبة", "accounting", "قانون", "law school", "legal",
  "gaming", "game", "ترفيه", "موسيقى",
  "منصة استثمار", "ارباح سريعة",
  "ازياء", "موضة", "fashion",
  "تجميل شعر", "حلاقة",
];

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 — AI SYSTEM PROMPT
// Built dynamically from the keyword lists above so it always stays in sync.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate the AI system prompt using the live keyword lists.
 * This ensures the AI prompt always matches the keyword classifier.
 */
export function buildAiSystemPrompt(): string {
  return `You are a strict classifier for a Telegram bot that joins ONLY medical and healthcare groups.
Your ONLY job: decide if a Telegram group is medically relevant. Answer with EXACTLY one word: "yes" or "no".

RELEVANT — answer "yes" for any of these categories:
- General medicine & specialties: internal medicine, family medicine, surgery, emergency, ICU, anesthesia, cardiology, neurology, dermatology, oncology, urology, ENT, ophthalmology, radiology, orthopedics, pediatrics, gynecology/obstetrics, psychiatry, rheumatology, nephrology, hepatology, gastroenterology, pulmonology, endocrinology, geriatrics, sports medicine, palliative care, forensic medicine
- Dentistry & subspecialties: orthodontics, endodontics (root canal), periodontics, prosthodontics, pedodontics, oral surgery, oral medicine, maxillofacial, dental hygiene, dental lab, dental implants
- Pharmacy: clinical pharmacy, pharmacology, pharmacist, pharmaceutical sciences, drug therapy, dispensing
- Nursing: all types (ICU, NICU, ER, pediatric, surgical, community, home care), midwifery, nurse practitioner
- Anesthesia & critical care: anesthesiology, sedation, pain management, ICU medicine
- Medical laboratory: hematology, pathology, microbiology, biochemistry, histology, cytology, blood bank, serology, immunology
- Physiotherapy, optometry, medical coding, paramedic, biomedical, health informatics, dietetics/nutrition
- Saudi/Gulf licensing exams: SCFHS, SMLE, Prometric, DHA, HAAD, SPLE (pharmacy), OSCE
- UK/International exams: PLAB, MRCP, MRCS, MRCGP, MRCEM, MRPCH, MRCOG, MRCPSYCH, FRCR, USMLE, NCLEX, NBDE, NAPLEX
- Arab/regional board exams: البورد العربي, البورد السعودي, زمالة طب, البورد الخليجي
- Medical residency, fellowship, housemanship, internship
- Medical education groups (students, residents, interns in health fields)
- Healthcare jobs and employment in medical fields
- Arabic medical specialties: طب، تمريض، صيدلة، أسنان، مختبر، أشعة، تخدير، عناية مركزة، etc.

ALWAYS REJECT — answer "no" immediately for:
- Investment, cryptocurrency, forex, trading, blockchain, NFT, ICO, USDT: استثمار، كريبتو، بيتكوين، فوركس، اكتتاب
- Medical excuse / sick-leave fraud: سكليف، اعذار طبية، عذر طبي، sick leave
- Advertising bots, منصة groups, امبات، كابيتال
- Quick-profit / MLM schemes: ربح سريع، تربح من
- General non-medical: news, religion, politics, entertainment, sports, cooking, business, real estate, engineering (civil/chemical/electrical/mechanical), law, accounting, hair styling, fashion
- Pure research/academic groups with NO medical content

CRITICAL RULES:
1. If a group mentions BOTH medical terms AND investment/crypto terms → "no" (advertising group).
2. A university group is relevant ONLY if it is specifically about a medical/health college or faculty.
3. Generic "university", "student", or "research" groups without medical focus → "no".
4. Arabic group names: طب/طبي/طبية/صحي/صحية alone are sufficient for "yes" if no hard-block signals.
5. Nurse/ممرض/ممرضة/تمريض → always "yes". Dental/dentist/أسنان → always "yes".`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7 — HELPER UTILITIES
// Shared utilities used by all consumers.
// ─────────────────────────────────────────────────────────────────────────────

/** Lowercase all entries in an array (pre-normalized for fast matching). */
export function normalizeKeywords(keywords: string[]): string[] {
  return keywords.map((k) => k.toLowerCase());
}

/** Check if any of the patterns exist as substring in text (case-insensitive). */
export function containsAnyKeyword(text: string, patterns: string[]): boolean {
  const lower = text.toLowerCase();
  for (const p of patterns) {
    if (lower.includes(p.toLowerCase())) return true;
  }
  return false;
}

// Pre-normalized caches (computed once at module load)
export const NORMALIZED_STRONG = normalizeKeywords(STRONG_MEDICAL_KEYWORDS);
export const NORMALIZED_HARD_BLOCKED = normalizeKeywords(HARD_BLOCKED_KEYWORDS);
export const NORMALIZED_ACADEMIC = normalizeKeywords(ACADEMIC_ONLY_KEYWORDS);
export const NORMALIZED_NOT_MEDICAL = normalizeKeywords(NOT_MEDICAL_KEYWORDS);
export const NORMALIZED_SOFT = normalizeKeywords(SOFT_MEDICAL_KEYWORDS);
