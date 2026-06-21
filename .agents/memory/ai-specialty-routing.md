---
name: AI Specialty Routing
description: How specialty classification works — keyword-first, AI as optional fallback
---

## Rule
Specialty classification is KEYWORD-FIRST (deterministic, instant, no API quota).
AI (Gemini) is used ONLY for items that keywords cannot classify.
Gemini free tier = 20 req/day — never rely on it as primary.

## Keyword Classifier
- File: `artifacts/api-server/src/lib/keywordSpecialtyClassifier.ts`
- Exported functions: `classifyByKeywords(title, url)`, `classifyBatchByKeywords(items)`, `isMedicalByKeywords(title, url)`
- Returns: "general" | "dentistry" | "nursing" | "anesthesia" | "laboratory" | "pharmacy" | "exams" | null
- Priority: exams → dentistry → nursing → anesthesia → laboratory → pharmacy → general → null
- Arabic + English patterns, handles URL slug extraction when no title

## Updated classifySpecialtyBatch in aiSpecialtyClassifier.ts
1. Run keyword classifier on ALL items first (synchronous)
2. Collect indices still null → send ONLY those to Gemini
3. On Gemini 429/error → silently keep keyword results
So even with Gemini quota exhausted, keyword results are always returned.

## Batch Classification POST /api/links/classify-batch
- Sources: JOINED + invite_requests + left_groups + skipped TARGET_LINKS + synced_dialogs (5 sources)
- Uses keyword classifier as primary (no API calls needed)
- AI supplement tried for remaining null items in batches of 20
- SSE events: classify_start, classify_progress, classify_complete

## Channels API
- GET /api/channels?specialty=X — filter by specialty (unclassified, non_medical, or code)
- GET /api/channels/stats — breakdown counts per specialty
- POST /api/channels/classify — classify ALL channels by keyword (background)
- DELETE /api/channels/non-medical — remove non-medical channels. Body: { includeUnclassified?: bool }
- DELETE /api/channels/:id — delete single channel
- GET /api/channels/export?specialty=X — export with specialty filter

## Specialty Routing in Engine
- account specialty "all" → picks links with no specialty filter
- account specialty X → picks ONLY links with specialty=X
- After join: fire-and-forget classifySpecialty() → sets specialty → calls ensureSpecialtyCollection()

## runMedicalRequeueFromHistory (POST /api/links/requeue-skipped)
- Collects distinct URLs from full join_history
- Enriches titles from TARGET_LINKS + JOINED + left_groups
- Classifies using keyword classifier SYNCHRONOUSLY (no AI delays, no batching)
- Candidates: not in TARGET_LINKS (not already joined) + failed with filter reasons + skipped
- Does NOT re-add: CHANNEL_BLOCKED (intentional), already active (pending/joined/invite_request)

**Why:** Gemini free tier is 20 req/day — completely unusable for bulk classification of thousands of items. Keyword classifier covers 90%+ of Arabic/English medical group names deterministically.

**How to apply:** Add new specialties to keywordSpecialtyClassifier.ts patterns AND aiSpecialtyClassifier.ts ALL_SPECIALTY_CODES. Always use classifyByKeywords() for bulk operations, never classifySpecialtyBatch() alone.
