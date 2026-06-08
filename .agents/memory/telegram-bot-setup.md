---
name: Telegram Bot Manager Setup
description: Critical decisions, gotchas, and architectural constraints for this Telegram multi-account bot manager project.
---

## Critical: @mtcute WASM in Production Build

`@mtcute/node` uses `require.resolve('@mtcute/wasm/mtcute-simd.wasm')` at runtime. When esbuild bundles everything into one `dist/index.mjs`, this path breaks and crashes the server (auth fails with "Cannot find module").

**Fix in `build.mjs` externals list:**
```
"@mtcute/*",
"mtcute",
"*.wasm",
```

This keeps @mtcute packages unresolved in the bundle so they load from `node_modules` at runtime where WASM files are accessible. Bundle shrinks from ~5.7mb to ~3.8mb as a side effect.

**Why:** esbuild inlines node_modules into the bundle, breaking relative path resolution inside @mtcute for `.wasm` file loading.

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

`drizzle-kit push` requires TTY (interactive prompts). In Replit bash, use:
```bash
psql "$DATABASE_URL" -c "ALTER TABLE ..."
```

## api-zod Index Fix

`lib/api-zod/src/index.ts` must only export from `"./generated/api"` — NOT from `"./generated/types"`. The types/ folder has TypeScript types with same names as Zod schemas, causing duplicate export errors.

**IMPORTANT:** Orval codegen OVERWRITES `lib/api-zod/src/index.ts` and re-adds the `./generated/types` export every time. After running `pnpm exec orval`, immediately run:
```
echo 'export * from "./generated/api";' > lib/api-zod/src/index.ts
```

## Port Configuration (Critical)

- Dashboard: port 5000 (Replit mandates port 5000 for webview — configureWorkflow enforces this, errors on other ports)
- API server: port 8080
- Vite proxy (`vite.config.ts`): `/api` → `http://localhost:8080` (MUST be set — without it, all API calls return Vite HTML, causing React crashes)
- If user sees white page but screenshot tool shows app working: browser cache. Instruct Ctrl+Shift+R (hard refresh).

## Deployment (Critical)

- Must use `vm` target (NOT autoscale) — bot engine uses in-memory timers + SQLite sessions that die on process restart
- Build: `pnpm --filter @workspace/api-server run build && pnpm --filter @workspace/dashboard run build`
- Run: `PORT=5000 NODE_ENV=production node --enable-source-maps artifacts/api-server/dist/index.mjs`
- In production: Express (app.ts) serves dashboard static files from `artifacts/dashboard/dist/public` when `NODE_ENV=production`

## Engine Account Rotation (Critical)

- `allActive` accounts query MUST have `.orderBy(asc(accountsTable.id))` — PostgreSQL heap order is non-deterministic; without ORDER BY, the module-level `accountIndex` round-robin breaks and same account repeats consecutively
- `flood_wait` accounts auto-reset at start of each tick: check `floodWaitUntil <= now`, update status→active
- `usable` filter only checks `joinedToday >= dailyLimit` (flood_wait already excluded via status filter)

## Retry Scheduling

- Unknown errors: mark link `failed` with `retryAfter = now + 1 hour`, `retryCount++`
- After MAX_RETRY_COUNT (3) exhausted: permanent failure, retryAfter = null
- Tick picks up `failed` links where `retryAfter <= now AND retryCount < MAX_RETRY_COUNT`
- Schema: `group_links.retry_after timestamptz` column

## already_joined

- Does NOT increment `joinedToday` (prevents burning the daily safety limit for pre-existing groups)
- Only increments `joinedCount` (total lifetime count)

## Settings DB Table

Added `settings` table (key/value store) for Telegram API credentials and system config.

`clientPool.ts` reads credentials: ENV vars first → cached DB values → DB query. Call `invalidateCredentialsCache()` after updating settings.

## Settings ALLOWED_KEYS

`settings.ts` PUT endpoint has an explicit `ALLOWED_KEYS` set. Any new setting key added to the app MUST also be added to this set or the route returns 400. Current set: `telegram_api_id`, `telegram_api_hash`, `auto_sync_interval_minutes`, `active_start_hour`, `ai_filter_enabled`, `mongo_backup_url`, `mongo_backup_db`.

## MongoDB Auto-Sync

`artifacts/api-server/src/lib/mongoSync.ts` — background scheduler, runs every 30 min by default. Started from `index.ts` via `startAutoSync()`. Deduplicates via unique URL constraint (catches error code 23505).

## P2/P3 Features Implemented

**P2-1 Device Profiles:** 20 real devices. DB migration adds device columns to `accounts`. Assigned on account creation.

**P2-2 Post-join observation:** `observeGroupAfterJoin(client, chatId, url)` — waits 3-10s then reads 8 messages.

**P2-3 Configurable sleep schedule:** `isBlackoutHourConfigurable` reads `active_start_hour` from settings. Daily ±1h jitter.

**P2-4 Auth revoked notification:** Engine emits `account_needs_auth` SSE event.

**P2-5 SSE Notifications:** `GET /api/events` SSE endpoint, `NotificationBell.tsx` in sidebar.

**P3-1 AI Filter:** `aiFilter.ts` uses `@google/generative-ai` + `GEMINI_API_KEY`. Falls back to keywords.

## Auth Flow (Telegram OTP)

In-memory `Map<phone, PendingSession>` holds TelegramClient mid-flow. Sessions auto-expire after 10 min. After verify, `client.exportSession()` string saved to `accounts.session_string`. Temp SQLite file deleted after auth.

## Engine

- Auto-resumes on restart if `bot_state.running = true` in DB
- Blackout: 2 AM – 8 AM no joins (configurable)
- Per-account safe interval: ~1029s (~17.2 min), ±25% jitter
- Action interval between ticks = safeInterval / N accounts (min 180s)
- Error handling: classifies all Telegram errors into flood_wait / peer_flood / channels_limit / already_joined / auth_revoked / account_banned / link_failed / unknown
