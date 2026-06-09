---
name: Telegram Bot Manager Setup
description: Architecture decisions, gotchas, and conventions for the MongoDB-only multi-account bot manager
---

# MongoDB-only architecture (June 2026)

## Rule: No PostgreSQL, Drizzle, SQLite, or better-sqlite3
All data lives in MongoDB (`MONGODB_URL` env var, database `Joining_links`). Fully removed: Drizzle ORM, pg driver, better-sqlite3, @workspace/api-zod dependency from api-server.

**Why:** User explicitly migrated away from PostgreSQL. MongoDB is the sole database.

**How to apply:** All new database operations go through `lib/db/src/mongo.ts` → `collections` accessor. Never re-add Drizzle or pg.

## Collections schema
- `accounts` — unique index on `phone`; field `sessionString` holds Telegram session string
- `TARGET_LINKS` — join queue, unique on `url`, status: pending/joined/failed/skipped
- `JOINED` — permanent dedup record, unique on `url`. Checked BEFORE every join; inserted on success. Persists across restarts.
- `Channels` — detected channel-type links (left immediately + saved here)
- `activity_log` — engine event log
- `join_history` — per-attempt record
- `mongo_collections` — external MongoDB sync sources config
- `settings` — key/value config, unique on `key`
- `bot_state` — singleton doc (`_id: "singleton"`)
- `tg_sessions` — session backup/import source

## Telegram client pool
Uses `MemoryStorage` from `@mtcute/core` — no SQLite files. Session strings stored in `accounts.sessionString`. **Do NOT re-add `better-sqlite3`.**

**Why:** `better-sqlite3` caused V8 symbol mismatch crash in this environment. MemoryStorage + MongoDB-backed session strings is the working pattern.

## Critical: @mtcute WASM in Production Build
`@mtcute/node` uses `require.resolve('@mtcute/wasm/mtcute-simd.wasm')` at runtime. esbuild must externalize it.

**Fix in `build.mjs` externals list:** `"@mtcute/*"`, `"mtcute"`, `"*.wasm"`

## lib/db build requirement
`lib/db` uses `composite: true` tsconfig and must be built (`pnpm --filter @workspace/db run build`) before api-server typecheck passes, because api-server references it via TypeScript project references.

## IDs
All MongoDB IDs are ObjectId strings. Routes accept `req.params.id` as string with `ObjectId.isValid(id)` check. No integer IDs anywhere.

## bot_state singleton
`_id: "singleton"` (string). Upserted on `initMongo()`. Use `getBotState()` / `setBotState()` helpers from `lib/db`.

## Port Configuration
- Dashboard: port 5000 (Replit webview)
- API server: port 8080
- Vite proxy (`vite.config.ts`): `/api` → `http://localhost:8080`

## Engine
- Auto-resumes on restart if `bot_state.running = true`
- Blackout: 2 AM – 8 AM (configurable via `active_start_hour` setting)
- Per-account safe interval: ~1029s (~17.2 min), ±25% jitter
- DAILY_LIMIT: 85 joins / account / 18-hour window
- JOINED dedup: checked at top of `attemptJoin()` before any Telegram call

## Auth Flow (Telegram OTP)
In-memory `Map<phone, PendingSession>` holds TelegramClient mid-flow. Sessions auto-expire after 10 min. After verify, `client.exportSession()` string saved to `accounts.sessionString`.

## Settings ALLOWED_KEYS
`telegram_api_id`, `telegram_api_hash`, `auto_sync_interval_minutes`, `active_start_hour`, `ai_filter_enabled`, `mongo_backup_url`, `mongo_backup_db`

## pnpm-workspace.yaml
`drizzle-orm` removed from catalog. `better-sqlite3` removed from `onlyBuiltDependencies`. `"drizzle-orm>better-sqlite3": "-"` override removed (no longer needed since Drizzle is gone).
