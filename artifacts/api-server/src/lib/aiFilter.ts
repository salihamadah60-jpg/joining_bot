/**
 * AI GROUP FILTER
 *
 * Uses Google Gemini API (GEMINI_API_KEY env var) to classify whether a
 * Telegram group is relevant (medical / research / educational).
 *
 * The system prompt is built dynamically from medicalKeywords.ts — the single
 * source of truth — so it always stays in sync with the keyword classifier.
 *
 * Falls back gracefully to keyword-only filter if:
 *  - GEMINI_API_KEY is not set
 *  - AI filter is disabled in settings
 *  - API call fails
 */

import { logger } from "./logger.js";
import { buildAiSystemPrompt } from "./medicalKeywords.js";

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

    const systemPrompt = buildAiSystemPrompt();
    const chat = model.startChat({ history: [{ role: "user", parts: [{ text: systemPrompt }] }] });
    const result = await chat.sendMessage(prompt);
    const answer = result.response.text().trim().toLowerCase();

    logger.debug({ title, answer }, "AI filter result");
    return answer.startsWith("yes");
  } catch (err) {
    logger.warn({ err, title }, "AI filter API call failed — using keyword fallback");
    return null;
  }
}
