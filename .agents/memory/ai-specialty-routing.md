---
name: AI Specialty Routing
description: How AI specialty classification and routing works for accounts and links
---

## Rule
Specialty classification uses Gemini AI (NOT keyword matching). Batch 20 items per API call.
Post-join classification is fire-and-forget (async IIFE, non-blocking).
Internal collections are auto-created per specialty (type: "internal").

## Files
- `artifacts/api-server/src/lib/aiSpecialtyClassifier.ts` — Gemini batch classifier, SYSTEM_PROMPT, ALL_SPECIALTY_CODES, classifySpecialtyBatched()
- `artifacts/api-server/src/lib/specialtyCollections.ts` — ensureSpecialtyCollection(), incrementSpecialtyCollectionCount(); in-memory cache
- `POST /api/links/classify-batch` in links.ts — batch classify existing joined+invite_request links, SSE events: classify_start/classify_progress/classify_complete

## Internal Collections
- `MongoCollectionDoc` has `type?: "internal" | "external"` and `specialty?: string` fields
- type="internal": no connection string, no sync, auto-created. Shown in Collections page with INTERNAL badge (purple).
- Sync endpoint blocks with 400 if type="internal"

## Specialty Routing in Engine
- account specialty "all" → picks links with no specialty filter
- account specialty X → picks ONLY links with specialty=X
- After join: fire-and-forget classifySpecialty(groupTitle) → sets specialty on TARGET_LINK → calls ensureSpecialtyCollection()

## Account Registration
- POST /accounts accepts body.specialty (string), defaults to "all"
- Accounts.tsx "Add Account" dialog has full specialty selector (30+ specialties)

## Batch Classification
- POST /api/links/classify-batch → returns immediately, runs in background
- Processes all joined+invite_request links with groupTitle but no specialty
- SSE events: classify_start, classify_progress, classify_complete, classify_error
- Collections.tsx handles these SSE events and shows a progress bar

**Why:** User explicitly required AI classification (not keyword matching) to handle the full variety of Arabic medical group names. Internal collections allow the specialty routing system to show specialty containers without external MongoDB sources.

**How to apply:** When adding new specialties, add them to ALL_SPECIALTY_CODES and SPECIALTY_DISPLAY_NAMES in aiSpecialtyClassifier.ts, and add the optgroup entries in both Accounts.tsx dialog and Collections.tsx SpecialtySelect.
