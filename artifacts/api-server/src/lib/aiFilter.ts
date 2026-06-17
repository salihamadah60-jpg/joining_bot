/**
 * AI GROUP FILTER — P3-1
 *
 * Uses Google Gemini API (GEMINI_API_KEY env var) to classify whether a
 * Telegram group is relevant (medical / research / educational).
 *
 * Falls back gracefully to keyword-only filter if:
 *  - GEMINI_API_KEY is not set
 *  - AI filter is disabled in settings
 *  - API call fails
 *
 * Uses gemini-2.5-flash for speed and cost efficiency.
 */

import { logger } from "./logger.js";

let GoogleGenAI: any = null;

async function loadGoogleGenAI() {
  if (GoogleGenAI) return GoogleGenAI;
  try {
    const mod = await import("@google/generative-ai");
    GoogleGenAI = mod.GoogleGenerativeAI;
    return GoogleGenAI;
  } catch {
    return null;
  }
}

let aiEnabled: boolean | null = null;

export function setAiFilterEnabled(enabled: boolean): void {
  aiEnabled = enabled;
}

export function isAiFilterEnabled(): boolean {
  if (aiEnabled !== null) return aiEnabled;
  return !!process.env["GEMINI_API_KEY"];
}

const SYSTEM_PROMPT = `You are a strict classifier for a Telegram bot that joins ONLY medical and healthcare groups.
Your ONLY job: decide if a Telegram group is medically relevant. Answer with EXACTLY one word: "yes" or "no".

RELEVANT — answer "yes" ONLY for:
- Medical specialties: general medicine, surgery, internal medicine, pediatrics, gynecology, psychiatry, orthopedics, cardiology, neurology, dermatology, oncology, urology, ENT, ophthalmology, emergency, ICU, anesthesia
- Dentistry and subspecialties: orthodontics (ortho), endodontics (endo), prosthodontics, periodontics, oral surgery, pedodontics
- Pharmacy, clinical pharmacy, pharmacology, pharmaceutical sciences
- Nursing (all types: ICU, pediatric, obstetric, emergency)
- Medical laboratory: hematology, microbiology, biochemistry, histology, pathology
- Radiology, MRI, CT scan, ultrasound, interventional radiology
- Physiotherapy, optometry, medical coding, medical technician (PCT, CSSD)
- Saudi healthcare exams: SCFHS, SMLE, Prometric, DHA, SPLE, OSCE, MRCS, FRCR
- Medical education groups (students, residents, interns in health fields)
- Healthcare jobs and employment

ALWAYS REJECT — answer "no" immediately:
- Investment, cryptocurrency, forex, trading, blockchain, NFT, ICO, USDT, ربح, استثمار, كريبتو, بيتكوين, فوركس
- IPO / stock offerings: اكتتاب, أكتتاب
- Medical excuse / sick-leave fraud groups: سكليف, اعذار طبية, عذر طبي
- Advertising bots, منصة (platform) groups, امبات, كابيتال
- Quick-profit / MLM schemes: ربح سريع, تربح من
- General non-medical: news, religion, politics, entertainment, sports, cooking, business, real estate, engineering, law, accounting
- Pure research/academic groups with NO medical content (e.g. "Applied Statistics", "Marketing Research")

CRITICAL: If a group mentions BOTH medical terms AND investment/crypto terms, answer "no" — it is an advertising group.
CRITICAL: A university group is relevant ONLY if it is specifically about a medical/health college or faculty. Generic "university" or "student" groups without medical focus = "no".`;




/**
 * Ask Gemini if a group is relevant based on its title and sample messages.
 * Returns null if AI is disabled or unavailable (caller uses keyword fallback).
 */
export async function aiClassifyGroup(
  title: string | null | undefined,
  sampleMessages: string[] = []
): Promise<boolean | null> {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey || !isAiFilterEnabled()) return null;

  const GenAI = await loadGoogleGenAI();
  if (!GenAI) {
    logger.warn("@google/generative-ai not available — AI filter disabled");
    return null;
  }

  try {
    const genAI = new GenAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const titlePart = title ? `Group title: "${title}"` : "Group title: unknown";
    const msgPart =
      sampleMessages.length > 0
        ? `\nSample messages:\n${sampleMessages.slice(0, 5).map((m) => `- ${m.substring(0, 100)}`).join("\n")}`
        : "";

    const prompt = `${titlePart}${msgPart}\n\nIs this group relevant to medicine, medical education, or health research?`;

    const chat = model.startChat({ history: [{ role: "user", parts: [{ text: SYSTEM_PROMPT }] }] });
    const result = await chat.sendMessage(prompt);
    const answer = result.response.text().trim().toLowerCase();

    logger.debug({ title, answer }, "AI filter result");
    return answer.startsWith("yes");
  } catch (err) {
    logger.warn({ err, title }, "AI filter API call failed — using keyword fallback");
    return null;
  }
}
