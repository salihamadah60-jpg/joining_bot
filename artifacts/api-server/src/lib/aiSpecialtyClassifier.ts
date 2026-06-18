/**
 * AI SPECIALTY CLASSIFIER
 *
 * Uses Google Gemini to classify Telegram group titles into medical specialties.
 * Works in batches of 20 items per API call for efficiency.
 *
 * Returns:
 *   specialty code  e.g. "dentistry", "nursing", "radiology"
 *   "exams"         for medical exam / licensing / board exam groups
 *   null            for non-medical groups
 */

import { logger } from "./logger.js";

export const ALL_SPECIALTY_CODES = [
  "general", "internal", "surgery", "pediatrics", "gynecology", "psychiatry",
  "orthopedics", "cardiology", "neurology", "dermatology", "oncology", "urology",
  "ent", "ophthalmology", "emergency", "icu", "anesthesia",
  "dentistry", "orthodontics", "endodontics", "prosthodontics", "periodontics",
  "oral_surgery", "pedodontics",
  "pharmacy", "clinical_pharmacy",
  "nursing",
  "laboratory", "pathology", "microbiology", "biochemistry",
  "radiology", "mri", "ct", "ultrasound",
  "physiotherapy", "optometry", "medical_coding", "medical_technician", "pct", "cssd",
  "exams",
] as const;

export type SpecialtyCode = (typeof ALL_SPECIALTY_CODES)[number] | null;

export const SPECIALTY_DISPLAY_NAMES: Record<string, string> = {
  general: "طب عام",
  internal: "باطنة وأمراض داخلية",
  surgery: "جراحة عامة",
  pediatrics: "أطفال وحديثي الولادة",
  gynecology: "نساء وتوليد",
  psychiatry: "طب نفسي وعصبي",
  orthopedics: "عظام وكسور",
  cardiology: "قلبية وأوعية",
  neurology: "أعصاب",
  dermatology: "جلدية",
  oncology: "أورام وسرطان",
  urology: "مسالك بولية",
  ent: "أنف وأذن وحنجرة",
  ophthalmology: "عيون",
  emergency: "طوارئ وإسعاف",
  icu: "عناية مركزة",
  anesthesia: "تخدير وإنعاش",
  dentistry: "أسنان عام",
  orthodontics: "تقويم الأسنان",
  endodontics: "علاج جذور",
  prosthodontics: "تعويضات أسنان",
  periodontics: "أمراض اللثة",
  oral_surgery: "جراحة الفم والفكين",
  pedodontics: "أسنان الأطفال",
  pharmacy: "صيدلة",
  clinical_pharmacy: "صيدلة سريرية",
  nursing: "تمريض",
  laboratory: "مختبرات طبية",
  pathology: "باثولوجيا",
  microbiology: "ميكروبيولوجيا",
  biochemistry: "كيمياء حيوية",
  radiology: "أشعة تشخيصية",
  mri: "رنين مغناطيسي MRI",
  ct: "مقطعية CT",
  ultrasound: "سونار وموجات",
  physiotherapy: "فيزيوثيرابي",
  optometry: "بصريات",
  medical_coding: "ترميز طبي",
  medical_technician: "فني طبي",
  pct: "رعاية مرضى PCT",
  cssd: "تعقيم CSSD",
  exams: "اختبارات وشهادات طبية",
};

const BATCH_SIZE = 20;

const SYSTEM_PROMPT = `You are an expert medical specialty classifier for Arabic and English Telegram group names.

TASK: Given a numbered list of Telegram group names, classify each one into the correct medical specialty code.

VALID SPECIALTY CODES:
general, internal, surgery, pediatrics, gynecology, psychiatry, orthopedics, cardiology, neurology, dermatology, oncology, urology, ent, ophthalmology, emergency, icu, anesthesia, dentistry, orthodontics, endodontics, prosthodontics, periodontics, oral_surgery, pedodontics, pharmacy, clinical_pharmacy, nursing, laboratory, pathology, microbiology, biochemistry, radiology, mri, ct, ultrasound, physiotherapy, optometry, medical_coding, medical_technician, pct, cssd, exams

SPECIAL CODE "exams": Medical licensing, board exams, assessment (Prometric, USMLE, SMLE, SCFHS, DHA, MOH, HAAD, OSCE, MRCS, FRCR, اختبار, زمالة, ابتعاث, بورد, ليسانس, امتحان, سكرين, مرخصين, تصنيف)

RETURN null: if the group has NOTHING to do with medicine or healthcare (crypto, business, religion, news, cooking, sports, engineering, accounting, etc.)

CLASSIFICATION GUIDE (Analyze MEANING not just keywords):
- dentistry: أسنان، سن، أضراس، تقويم، لثة، جذور، تيجان، تركيبات، حشوات، طب الفم، زراعة، implant, prostho, endo, ortho, perio, oral, fissure
- orthodontics: تقويم الأسنان specifically, ortho, braces, aligner
- endodontics: علاج الجذور, endo, root canal, pulp
- prosthodontics: تعويضات أسنان, crowns, bridges, dentures, prostho
- periodontics: اللثة, perio, gum disease, periodontitis
- oral_surgery: جراحة الفم والفكين, oral surgery, jaw, extraction
- pedodontics: أسنان الأطفال, pedodontics, pediatric dentistry
- pharmacy: صيدلة، دواء، عقاقير، صيدلي، pharmacology, clinical pharmacy, dispensing, drug
- nursing: تمريض، ممرض، ممرضة، nurse, ICU nurse, midwife, caring
- laboratory: مختبر، تحاليل، هيماتولوجي، CBC، serology, microbiology, pathology, biochemistry, lab
- radiology: أشعة، رنين، سونار، مقطعية، CT, MRI, ultrasound, imaging, nuclear medicine, interventional
- mri: رنين مغناطيسي specifically, MRI technician, MRI scan
- ct: مقطعية CT specifically, CT scan technician
- ultrasound: سونار, ultrasound, echo specifically
- physiotherapy: فيزيوثيرابي، علاج طبيعي، تأهيل، physiotherapy, rehabilitation, sports medicine therapy
- emergency: طوارئ، إسعاف، emergency, trauma, EMS
- icu: عناية مركزة، ICU, critical care, PICU, NICU (intensive care)
- cardiology: قلب، أوعية، قلبية، cardiac, ECG, catheter, stent, arrhythmia
- neurology: أعصاب، نيورو، stroke, epilepsy, EEG, neurosurgery (if neurology context)
- psychiatry: نفسي، نفسية، طب نفسي، psychiatry, psychology (medical context), mental health
- surgery: جراحة عامة، جراح، laparoscopy, OR, operating room, surgical
- orthopedics: عظام، كسور، مفاصل، bone, fracture, spine, arthroplasty
- pediatrics: أطفال، طفل، pediatrics, neonatology, NICU (pediatric context)
- gynecology: نساء، توليد، حمل، obstetrics, gynecology, maternity, IVF
- dermatology: جلدية، جلد، skin, dermatology, cosmetology (medical), acne, psoriasis
- oncology: أورام، سرطان، oncology, chemotherapy, cancer, tumor
- ent: أنف، أذن، حنجرة، ENT, otolaryngology, hearing, cochlear
- ophthalmology: عيون، بصر، eye, retina, cataract, glaucoma, ophthalmology
- anesthesia: تخدير، إنعاش، anesthesia, analgesia, sedation, pain management
- urology: مسالك بولية, urology, kidney stone, prostate, bladder
- general: mixed medical, general medicine students, general health groups without specific specialty
- optometry: بصريات, optometry, glasses, contact lens, refraction (NOT ophthalmology surgery)
- medical_coding: ترميز طبي, ICD, CPT, medical coding, billing
- medical_technician: فني طبي general, paramedic support technician
- pct: رعاية مرضى, patient care technician, PCT, CNA
- cssd: تعقيم, CSSD, sterilization, autoclave

IMPORTANT RULES:
1. Analyze FULL MEANING and CONTEXT of the group name
2. Arabic medical groups often have informal or combined names - understand them intelligently
3. If group is specifically about ONE subspecialty (e.g., orthodontics), use the subspecialty code, NOT the parent (dentistry)
4. Medical student groups without specific specialty → use "general"
5. If BOTH medical AND investment/crypto mentioned → return null (advertising group)
6. Groups like "مجموعة اطباء" (doctors group) without specialty → "general"
7. "Healthcare jobs" or "medical employment" without specialty → "general"
8. If ambiguous between two subspecialties, pick the MORE SPECIFIC one

OUTPUT FORMAT: Return ONLY a valid JSON array, no explanation:
[{"i":0,"s":"specialty_code_or_null"}, {"i":1,"s":"dentistry"}, {"i":2,"s":null}]`;

async function loadGemini(): Promise<any | null> {
  try {
    const mod = await import("@google/generative-ai");
    return mod.GoogleGenerativeAI;
  } catch {
    return null;
  }
}

/**
 * Classify a SINGLE group title into a medical specialty.
 * Returns null if not medical, or if Gemini is unavailable.
 */
export async function classifySpecialty(
  title: string | null | undefined,
  url?: string | null
): Promise<SpecialtyCode> {
  if (!title && !url) return null;
  const results = await classifySpecialtyBatch([{ title, url }]);
  return results[0] ?? null;
}

/**
 * Classify MULTIPLE groups in one Gemini API call (up to 20 per batch).
 * Returns an array of specialty codes with the same length as input.
 */
export async function classifySpecialtyBatch(
  items: Array<{ title?: string | null; url?: string | null }>
): Promise<Array<SpecialtyCode>> {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) return items.map(() => null);

  const GenAI = await loadGemini();
  if (!GenAI) {
    logger.warn("@google/generative-ai not available — specialty classifier disabled");
    return items.map(() => null);
  }

  try {
    const genAI = new GenAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const inputs = items.map((item, i) => {
      const name =
        item.title?.trim() ||
        item.url?.replace(/https?:\/\/t\.me\/\+?/, "").replace(/[_+]/g, " ").trim() ||
        `group_${i}`;
      return `${i}: ${name}`;
    });

    const prompt = `${SYSTEM_PROMPT}\n\nClassify these groups:\n${inputs.join("\n")}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      logger.warn({ text: text.substring(0, 300) }, "AI specialty: no JSON in response");
      return items.map(() => null);
    }

    const parsed: Array<{ i: number; s: string | null }> = JSON.parse(jsonMatch[0]);
    const resultMap = new Map<number, SpecialtyCode>();
    for (const entry of parsed) {
      const code = entry.s;
      if (code === null || (ALL_SPECIALTY_CODES as readonly string[]).includes(code)) {
        resultMap.set(entry.i, code as SpecialtyCode);
      }
    }

    return items.map((_, i) => resultMap.get(i) ?? null);
  } catch (err) {
    logger.warn({ err }, "AI specialty batch classify failed");
    return items.map(() => null);
  }
}

/**
 * Process items in BATCHES of BATCH_SIZE with optional progress callback.
 * Use this for classifying large numbers of links.
 */
export async function classifySpecialtyBatched(
  items: Array<{ title?: string | null; url?: string | null }>,
  onProgress?: (done: number, total: number) => void
): Promise<Array<SpecialtyCode>> {
  const results: Array<SpecialtyCode> = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const chunk = items.slice(i, i + BATCH_SIZE);
    const chunkResults = await classifySpecialtyBatch(chunk);
    results.push(...chunkResults);
    onProgress?.(Math.min(i + BATCH_SIZE, items.length), items.length);
  }
  return results;
}
