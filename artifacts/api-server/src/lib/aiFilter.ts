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

const SYSTEM_PROMPT = `You are a strict group classifier for a Telegram bot.
Your ONLY job: decide if a Telegram group is relevant to medicine, medical education, scientific research, or health sciences.
Answer with EXACTLY one word: "yes" or "no".

Relevant: medical groups, doctor groups, nursing, pharmacy, medical students, hospitals, health research, anatomy, physiology, biochemistry, pathology, clinical groups, scientific research, academic medicine.
NOT relevant: general chat, religion, politics, entertainment, business, news, sports, games, cooking, etc.`;

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
