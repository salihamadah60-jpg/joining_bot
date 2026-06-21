/**
 * AI SPECIALTY CLASSIFIER — 9 Simplified Categories
 *
 * Uses Google Gemini to classify Telegram group titles into ONE of 9 medical specialties.
 * Works in batches of 20 items per API call for efficiency.
 *
 * Returns: specialty code (one of 9) or null for non-medical groups.
 */

import { logger } from "./logger.js";

export const ALL_SPECIALTY_CODES = [
  "general",      // طب عام (includes all clinical medicine sub-specialties)
  "dentistry",    // طب أسنان (includes all dental sub-specialties)
  "nursing",      // تمريض
  "anesthesia",   // تخدير وإنعاش
  "laboratory",   // مختبرات طبية (includes pathology, micro, biochem)
  "pharmacy",     // صيدلة (includes clinical pharmacy)
  "exams",        // ابتعاث واختبارات طبية (SMLE, Prometric, board exams, scholarships)
  "channels_only", // مُستخدم للتوجيه فقط — ليس ناتج AI
] as const;

export type SpecialtyCode = (typeof ALL_SPECIALTY_CODES)[number] | null;

export const SPECIALTY_DISPLAY_NAMES: Record<string, string> = {
  general: "طب عام",
  dentistry: "طب أسنان",
  nursing: "تمريض",
  anesthesia: "تخدير وإنعاش",
  laboratory: "مختبرات طبية",
  pharmacy: "صيدلة",
  exams: "ابتعاث واختبارات",
  channels_only: "قنوات طبية فقط",
};

/**
 * Maps old detailed specialty codes → new simplified parent code.
 * Used to migrate existing DB records and for routing logic.
 */
export const SPECIALTY_PARENT_MAP: Record<string, string> = {
  // طب عام (general)
  internal: "general", surgery: "general", pediatrics: "general",
  gynecology: "general", psychiatry: "general", orthopedics: "general",
  cardiology: "general", neurology: "general", dermatology: "general",
  oncology: "general", urology: "general", ent: "general",
  ophthalmology: "general", emergency: "general", icu: "general",
  radiology: "general", mri: "general", ct: "general", ultrasound: "general",
  physiotherapy: "general", optometry: "general", medical_coding: "general",
  medical_technician: "general", pct: "general", cssd: "general",
  // طب أسنان (dentistry)
  orthodontics: "dentistry", endodontics: "dentistry", prosthodontics: "dentistry",
  periodontics: "dentistry", oral_surgery: "dentistry", pedodontics: "dentistry",
  // صيدلة (pharmacy)
  clinical_pharmacy: "pharmacy",
  // مختبرات (laboratory)
  pathology: "laboratory", microbiology: "laboratory", biochemistry: "laboratory",
};

const BATCH_SIZE = 20;

const BATCH_DELAY_MS = 4_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SYSTEM_PROMPT = `You are an expert medical specialty classifier for Arabic and English Telegram group names.

TASK: Given a numbered list of Telegram group names, classify each into exactly ONE of these 9 specialty codes.

━━━ THE 9 VALID CODES ━━━
general    → All clinical medicine (طب عام, باطنة, جراحة, أطفال, قلب, عظام, أعصاب, نساء, جلدية, عيون, أنف, طوارئ, أشعة, أورام, بولية, ICU, طب نفسي, فيزيوثيرابي, بصريات, ترميز طبي, فني, PCT, CSSD, تشخيص, التصوير الطبي — كل ما هو طب سريري ليس أسنان ولا تمريض ولا تخدير ولا مختبرات ولا صيدلة)
dentistry  → طب الأسنان بجميع تخصصاته (تقويم، جذور، لثة، تعويضات، جراحة الفم، أسنان أطفال)
nursing    → تمريض، ممرض، ممرضة، nurse, midwife, caring, ICU nurse
anesthesia → تخدير، إنعاش، anesthesia, sedation, pain management, pain clinic
laboratory → مختبرات، تحاليل، هيماتولوجيا، باثولوجيا، ميكروبيولوجيا، كيمياء حيوية، CBC، serology, lab, clinical lab
pharmacy   → صيدلة، دواء، عقاقير، صيدلاني، pharmacology, clinical pharmacy, dispensing
exams      → اختبارات ترخيص طبي وابتعاث: Prometric, USMLE, SMLE, SCFHS, DHA, MOH, HAAD, OSCE, MRCS, FRCR, بورد, زمالة, ابتعاث, ترخيص, امتحان, اختبار, مرخصين, تصنيف SCFHS, سكرين

RETURN null → إذا المجموعة لا علاقة لها بالطب أو الرعاية الصحية (crypto, trading, business, religion, cooking, sports, news, engineering, accounting, general chat, إلخ)

━━━ قواعد مهمة ━━━
1. تخدير = anesthesia (ليس general — لها تخصص مستقل)
2. مختبرات/تحاليل = laboratory (ليس general)
3. صيدلة = pharmacy
4. تمريض = nursing
5. إذا كانت المجموعة عن "طب" بشكل عام بدون تخصص محدد → general
6. مجموعات الطلاب الطبيين بدون تخصص → general
7. مجموعات عن SMLE/Prometric/ترخيص/ابتعاث/زمالة → exams
8. مجموعات الأسنان بكل أنواعها (تقويم، جذور، لثة...) → dentistry
9. إذا ذُكر crypto/trading/استثمار مع الطب → null (مجموعة إعلانية)
10. صورة شخصية/دردشة/منوعات = null

OUTPUT FORMAT: Return ONLY a valid JSON array, no explanation, no markdown:
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
 * Classify MULTIPLE groups.
 *
 * STRATEGY (in order):
 * 1. Keyword classifier (instant, no API) — handles the vast majority.
 * 2. Gemini AI — ONLY called for items that keywords couldn't determine,
 *    and ONLY when GEMINI_API_KEY is set and quota is available.
 *    AI failure is silent — keyword result (null) is returned instead.
 */
export async function classifySpecialtyBatch(
  items: Array<{ title?: string | null; url?: string | null }>
): Promise<Array<SpecialtyCode>> {
  const { classifyBatchByKeywords } = await import("./keywordSpecialtyClassifier.js");

  // Step 1: keyword classifier — runs synchronously, no quota issues
  const results: Array<SpecialtyCode> = classifyBatchByKeywords(items);

  // Step 2: collect indices that keywords couldn't classify (null)
  const needsAI: number[] = [];
  for (let i = 0; i < results.length; i++) {
    if (results[i] === null) needsAI.push(i);
  }

  // If everything was classified by keywords, skip AI entirely
  if (needsAI.length === 0) {
    logger.debug({ count: items.length }, "All items classified by keywords — no AI needed");
    return results;
  }

  // Step 3: try Gemini for the remaining uncertain items
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) {
    logger.debug("GEMINI_API_KEY not set — using keyword results only");
    return results;
  }

  const GenAI = await loadGemini();
  if (!GenAI) {
    logger.debug("@google/generative-ai not available — using keyword results only");
    return results;
  }

  try {
    const genAI = new GenAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const aiItems = needsAI.map((idx) => items[idx]!);
    const inputs = aiItems.map((item, j) => {
      const name =
        item.title?.trim() ||
        item.url?.replace(/https?:\/\/t\.me\/\+?/, "").replace(/[_+]/g, " ").trim() ||
        `group_${j}`;
      return `${j}: ${name}`;
    });

    const prompt = `${SYSTEM_PROMPT}\n\nClassify these ${aiItems.length} groups:\n${inputs.join("\n")}`;
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed: Array<{ i: number; s: string | null }> = JSON.parse(jsonMatch[0]);
      const VALID_CODES = new Set<string>(ALL_SPECIALTY_CODES.filter(c => c !== "channels_only"));

      for (const entry of parsed) {
        if (typeof entry.i !== "number") continue;
        const originalIdx = needsAI[entry.i];
        if (originalIdx === undefined) continue;
        const raw = entry.s;
        if (raw === null) {
          // AI says not medical — keep null
        } else if (VALID_CODES.has(raw)) {
          results[originalIdx] = raw as SpecialtyCode;
        } else if (SPECIALTY_PARENT_MAP[raw]) {
          results[originalIdx] = SPECIALTY_PARENT_MAP[raw] as SpecialtyCode;
        } else {
          results[originalIdx] = "general";
        }
      }
      logger.debug({ total: items.length, sentToAI: needsAI.length }, "AI batch classify supplemented keyword results");
    }
  } catch (err: any) {
    // Quota exceeded or other AI error — silently use keyword results
    logger.debug({ msg: String(err?.message ?? err).substring(0, 120) }, "AI classify skipped (using keyword results)");
  }

  return results;
}

/**
 * Process items in BATCHES of BATCH_SIZE with optional progress callback.
 * Keywords handle most items instantly; AI is only invoked for the remainder.
 */
export async function classifySpecialtyBatched(
  items: Array<{ title?: string | null; url?: string | null }>,
  onProgress?: (done: number, total: number) => void
): Promise<Array<SpecialtyCode>> {
  const results: Array<SpecialtyCode> = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    if (i > 0) {
      await sleep(BATCH_DELAY_MS);
    }
    const chunk = items.slice(i, i + BATCH_SIZE);
    const chunkResults = await classifySpecialtyBatch(chunk);
    results.push(...chunkResults);
    onProgress?.(Math.min(i + BATCH_SIZE, items.length), items.length);
  }
  return results;
}
