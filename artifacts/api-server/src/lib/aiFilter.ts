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

const SYSTEM_PROMPT = `You are a strict group classifier for a Telegram bot that joins ONLY medical, health, and academic research groups.
Your ONLY job: decide if a Telegram group is relevant. Answer with EXACTLY one word: "yes" or "no".

RELEVANT (answer "yes"):
- Medical groups: doctors, nurses, pharmacy, hospitals, clinics, health research
- Medical students / academic medicine / medical university groups
- Health sciences: anatomy, physiology, biochemistry, pathology, radiology
- Scientific / academic research groups

ALWAYS REJECT (answer "no" immediately — do NOT consider these relevant):
- Investment groups: any mention of استثمار, investment, profit, returns, returns on investment
- Cryptocurrency / blockchain: crypto, bitcoin, ethereum, blockchain, NFT, ICO, ICO, USDT, عملات رقمية, كريبتو, بيتكوين
- Trading groups: forex, فوركس, trading signals, توصيات تداول, مضاربة (speculation)
- IPO / stock offerings: اكتتاب, IPO, أكتتاب
- Advertising platforms: any group named "منصة" (platform) — these are advertising/investment bots
- امبات / أمبات — multi-level marketing or investment scheme
- كابيتال / capital — financial groups
- Make-money / quick profit groups: ربح سريع, تربح, earn money fast
- General non-medical: news, religion, politics, entertainment, sports, cooking, business, real estate

If a group mentions BOTH medical terms AND investment/crypto terms, answer "no" — it is likely an advertising group disguised with medical keywords.`;


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
