---
name: Leave Engine Architecture
description: Independent leave system separate from join engine — how it works and key decisions
---

## Rule
The leave engine is completely independent from the join engine. Never mix their timers or logic.

**Why:** User requirement: leave operations must have free timing, not blocked by join scheduling. Also channels_limit accounts need background cleanup without stopping the join engine for other accounts.

## How to apply
- Join engine: `telegramEngine.ts` — runs on its own timer, handles pending links
- Leave engine: `leaveEngine.ts` — runs on its own 10-min interval, handles channels_limit accounts
- Both started from `index.ts` after MongoDB init
- `leaveGroupsBatch()` is also called directly from the API for manual batch-leave from UI

## Key behaviors
- After batch-leave: if channelsCount < 450 and status was channels_limit → auto-reactivate to "active"
- Auto-cleanup: classify each synced_dialog title with isRelevantGroupAsync → leave if relevant===false
- Leaves are saved to `left_groups` collection (MongoDB) with reason, title, url, phone
- Rejoin: POST /api/leave/rejoin re-adds URLs to TARGET_LINKS as "pending"

## Missing medical keywords (added)
تجبير (orthopedic casting), تعقيم (CSSD/sterilization), ترميز (medical coding),
رعاية مرضى (PCT), ستيب/STEP (Saudi medical exam), CSSD, ECG, EEG, PCT, SCFHS,
هيئة التخصصات, برامج الهيئة — all clearly medical, were missing from groupFilter.ts

## Channels page (Channels.tsx)
3 tabs: إدارة المغادرة (batch leave with account selector + checkboxes), سجل المغادرة (history + rejoin), القنوات المكتشفة (read-only channel links)
