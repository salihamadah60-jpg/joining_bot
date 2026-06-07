---
name: Telegram Bot Manager Setup
description: Critical decisions, gotchas, and architectural constraints for this Telegram multi-account bot manager project.
---

## Stack Decision: @mtcute/node

- Using `@mtcute/node` for Telegram MTProto (not GramJS — blocked by firewall on `es5-ext`)
- Session stored in SQLite file per phone: `artifacts/api-server/sessions/{phone}.db`
- Session also exported as string and backed up to `accounts.session_string` DB column
- `better-sqlite3` is @mtcute's SQLite dependency (native module)

## Critical: better-sqlite3 Setup

Two things BOTH required for better-sqlite3 to work:
1. `onlyBuiltDependencies` in `pnpm-workspace.yaml` must include `better-sqlite3` (allows native build scripts)
2. `better-sqlite3` must be a direct `dependency` in `artifacts/api-server/package.json`

**Why:** pnpm won't build native modules unless explicitly allowed; Node.js ESM can't resolve packages that aren't direct deps.

## Critical: drizzle-orm Dual Instance

`@mtcute/node` brings `better-sqlite3` as a peer dep. Without the override below, pnpm creates TWO instances of drizzle-orm (with/without better-sqlite3) whose private TS types are incompatible.

**Fix in `pnpm-workspace.yaml`:**
```yaml
overrides:
  "drizzle-orm>better-sqlite3": "-"
```
Never remove this override.

## DB Migrations

`drizzle-kit push` requires TTY (interactive prompts). In Replit bash, use raw SQL via:
```js
// node --input-type=module < /tmp/migrate.mjs
import pg from '/home/runner/workspace/node_modules/.pnpm/pg@8.20.0/node_modules/pg/lib/index.js';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await pool.query('ALTER TABLE ...');
```

## api-zod Index Fix

`lib/api-zod/src/index.ts` must only export from `"./generated/api"` — NOT from `"./generated/types"`. The types/ folder has TypeScript types with same names as Zod schemas, causing duplicate export errors.

**IMPORTANT:** Orval codegen OVERWRITES `lib/api-zod/src/index.ts` and re-adds the `./generated/types` export every time. After running `pnpm exec orval`, immediately run:
```
echo 'export * from "./generated/api";' > lib/api-zod/src/index.ts
```
The codegen npm script in `api-spec/package.json` also runs typecheck — to avoid the typecheck failure, run orval separately first, fix the index, then typecheck.

## Settings DB Table

Added `settings` table (key/value store) for Telegram API credentials and system config. Migration: `CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY, value text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`.

`clientPool.ts` reads credentials: ENV vars first → cached DB values → DB query. Call `invalidateCredentialsCache()` after updating settings.

## Workflow Environment Variables

The "Start application" workflow command must include both PORT and BASE_PATH:
```
PORT=8080 pnpm --filter @workspace/api-server run dev & PORT=23183 BASE_PATH=/ pnpm --filter @workspace/dashboard run dev & wait
```

## MongoDB Auto-Sync

`artifacts/api-server/src/lib/mongoSync.ts` — background scheduler, runs every 30 min by default. Started from `index.ts` via `startAutoSync()`. Deduplicates via unique URL constraint (catches error code 23505).

## Plan File Location

Full project plan (atomic, with status per feature): `/home/runner/workspace/PLAN.md`

## P2/P3 Features Implemented

**P2-1 Device Profiles:** `lib/deviceProfiles.ts` has 20 real devices. DB migration adds `device_model`, `system_version`, `app_version`, `system_lang_code` to `accounts`. `clientPool.getClient()` accepts optional third `DeviceProfile` arg passed as constructor options. Accounts route assigns device on creation.

**P2-2 Post-join observation:** `observeGroupAfterJoin(client, chatId, url)` in `groupFilter.ts` — waits 3-10s random then tries `client.getHistory(chatId, {limit:8})` returning sample message strings. Returns empty array on failure (restricted group).

**P2-3 Configurable sleep schedule:** `timing.ts` exports `isBlackoutHourConfigurable(startHour, activeHours, applyJitter)` and `msUntilActiveStartConfigurable(startHour)`. Engine reads `active_start_hour` from settings table each tick. Daily ±1h jitter cached per calendar day.

**P2-4 Auth revoked notification:** On `auth_revoked` error, engine emits `account_needs_auth` SSE event, account set to `needs_auth`. User sees notification in dashboard to re-auth via Accounts page.

**P2-5 SSE Notifications:** `eventBus.ts` = singleton EventEmitter. `routes/events.ts` = `GET /api/events` SSE endpoint with keepalive. `NotificationBell.tsx` = component in sidebar footer with unread badge and dropdown panel. Emits: engine_started/stopped, join_success, account_banned, account_needs_auth, channels_limit, flood_wait_long, links_exhausted.

**P3-1 AI Filter:** `aiFilter.ts` uses `@google/generative-ai` + `GEMINI_API_KEY` env var. Model: `gemini-2.5-flash`. Returns `boolean | null` (null = fallback to keywords). Engine reads `ai_filter_enabled` from settings and calls `setAiFilterEnabled()` each tick. Toggle in Settings page. `isRelevantGroupAsync()` in groupFilter.ts tries AI first then falls back.

## Env Vars Used

Removed: `SESSION_SECRET` (not needed).
Active: `DATABASE_URL`, `PG*`, `GEMINI_API_KEY` (P3-1 AI filter).
Optional: `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` (or set via Settings page).

## Auth Flow (Telegram OTP)

In-memory `Map<phone, PendingSession>` holds TelegramClient mid-flow. Sessions auto-expire after 10 min. After verify, `client.exportSession()` string is saved to `accounts.session_string`. Temp SQLite file (`auth_{phone}.db`) deleted after auth completes.

## Engine

- Auto-resumes on restart if `bot_state.running = true` in DB
- Blackout: 2 AM – 8 AM no joins
- Per-account safe interval: ~1029s (~17.2 min), ±25% jitter
- Action interval between ticks = safeInterval / N accounts (min 180s)
- Error handling: classifies all Telegram errors into flood_wait / peer_flood / channels_limit / already_joined / auth_revoked / account_banned / link_failed / unknown
