/**
 * KEYWORD-BASED SPECIALTY CLASSIFIER
 *
 * Deterministic, zero-API, instant classification of Arabic/English Telegram
 * group names into one of the 8 medical specialties.
 *
 * ALL keyword lists are imported from medicalKeywords.ts — the single source
 * of truth. Never add keywords here directly; add them there instead.
 *
 * Priority order: EXAMS → DENTISTRY → NURSING → ANESTHESIA → LABORATORY
 *                 → PHARMACY → GENERAL → null (not medical)
 *
 * Also exports classifyGroupConfidence() → 4-tier:
 *   medical | probably_medical | uncertain | non_medical
 */

import {
  EXAMS_KEYWORDS,
  DENTISTRY_KEYWORDS,
  NURSING_KEYWORDS,
  ANESTHESIA_KEYWORDS,
  LABORATORY_KEYWORDS,
  PHARMACY_KEYWORDS,
  GENERAL_KEYWORDS,
  NOT_MEDICAL_KEYWORDS,
  SOFT_MEDICAL_KEYWORDS,
} from "./medicalKeywords.js";

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
  if (containsAny(text, NOT_MEDICAL_KEYWORDS) && !containsAny(text, [
    "طب", "medical", "pharmacy", "nursing", "clinical", "hospital",
    "dentist", "laborator",
  ])) {
    return null;
  }

  // Priority classification (order matters)
  if (containsAny(text, EXAMS_KEYWORDS))      return "exams";
  if (containsAny(text, DENTISTRY_KEYWORDS))  return "dentistry";
  if (containsAny(text, NURSING_KEYWORDS))    return "nursing";
  if (containsAny(text, ANESTHESIA_KEYWORDS)) return "anesthesia";
  if (containsAny(text, LABORATORY_KEYWORDS)) return "laboratory";
  if (containsAny(text, PHARMACY_KEYWORDS))   return "pharmacy";
  if (containsAny(text, GENERAL_KEYWORDS))    return "general";

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

  if (!raw || raw.length < 2) return "uncertain";

  const text = raw.toLowerCase();

  // Definitely medical (specialty matched)
  const specialty = classifyByKeywords(title, url);
  if (specialty !== null) return "medical";

  // Definitely non-medical
  if (
    containsAny(text, NOT_MEDICAL_KEYWORDS) &&
    !containsAny(text, ["طب", "medical", "pharmacy", "nursing", "clinical", "hospital", "dentist"])
  ) {
    return "non_medical";
  }

  // Soft / probable medical
  if (containsAny(text, SOFT_MEDICAL_KEYWORDS)) return "probably_medical";

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
