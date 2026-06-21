---
name: Keyword Classifier Comprehensive
description: How the 4-tier confidence classifier works and what was added vs the old 3-state version
---

# Keyword Classifier — Comprehensive Edition

## classifyByKeywords() — specialty → null
Returns one of: exams | dentistry | nursing | anesthesia | laboratory | pharmacy | general | null

## classifyGroupConfidence() — 4-tier for leave history display
Returns: "medical" | "probably_medical" | "uncertain" | "non_medical"

- **medical**: classifyByKeywords returned a specialty
- **probably_medical**: SOFT_MEDICAL matched (Saudi cities, years 2024-2027, Arabic/English months, "rotation", "intern", "candidate", "oet", "goethe", "ielts", "student")
- **uncertain**: no title or no pattern matched
- **non_medical**: NOT_MEDICAL matched AND no medical override

## Key expansions made
- EXAMS: added SPLE, SDLE, MRCGP, MRCEM, eMRCOG, PASTEL, board variants, البورد العربي, أوسكي, residency, fellowship, rotation, diploma, CME, Goethe, OET, PTE, INBDE, NAPLEX
- GENERAL: added ENT, ER, emergency room, OBGYN, fetal medicine, PEM, IMD, ICU variants, home care, imaging, all subspecialties
- NURSING: added home care nursing, community nursing, critical care nursing
- DENTISTRY: all subspecialties (endodontics, periodontics, prosthodontics, oral surgery)

## Rejoin fix (leave.ts)
Old: insertOne → fails silently on duplicate key (skipped++)
New: findOne → if pending/joined skip; if failed/skipped → updateOne reset to pending; if new → insertOne

**Why:** Links that previously failed/were skipped were counted as "skipped" by the old code, so rejoin appeared to do nothing even though the URLs existed in the collection.

## Leave history API
`GET /api/leave/history` now returns `classification: MedicalConfidence` per item.
LeaveHistoryTab in Channels.tsx shows 4 filter buttons + LeftGroupBadge component.
