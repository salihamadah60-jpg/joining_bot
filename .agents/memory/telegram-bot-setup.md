---
name: Telegram Bot Manager Setup
description: Critical decisions, gotchas, and architectural constraints for this Telegram multi-account bot manager project.
---

## CRITICAL: No SQLite / better-sqlite3 — Use MemoryStorage

`better-sqlite3` was permanently removed from the project. It caused a V8 symbol mismatch crash (`undefined symbol: _ZN2v812api_internal33ConvertToJSGlobalProxyIfNecessaryEm`) because the binary was compiled for a different Node.js version.

**Fix applied:**
- Removed `better-sqlite3` from `api-server/package.json`
- Added `@mtcute/core` as direct dependency
- `clientPool.ts` now uses `new MemoryStorage()` (from `@mtcute/core`) instead of SQLite file paths
- `auth.ts` now uses `createTempClient()` which also uses `MemoryStorage` — no temp `.db` files

**Why:** Sessions persist across restarts via `sessionString` column in PostgreSQL and MongoDB `tg_sessions`. MemoryStorage is loaded from DB on client creation.

**Do NOT re-add `better-sqlite3`** — user explicitly demanded its permanent removal.

## Critical: @mtcute WASM in Production Build

`@mtcute/node` uses `require.resolve('@mtcute/wasm/mtcute-simd.wasm')` at runtime. When esbuild bundles everything into one `dist/index.mjs`, this path breaks and crashes the server.

**Fix in `build.mjs` externals list:**
```
"@mtcute/*",
"mtcute",
"*.wasm",
```

**Why:** esbuild inlines node_modules into the bundle, breaking relative path resolution inside @mtcute for `.wasm` file loading.

## Stack Decision: @mtcute/node

- Using `@mtcute/node` for Telegram MTProto (not GramJS — blocked by firewall on `es5-ext`)
- Session stored as string in `accounts.session_string` (PostgreSQL) + MongoDB `tg_sessions`
- MemoryStorage used for all clients — no SQLite files needed

## Critical: drizzle-orm Dual Instance

`@mtcute/node` brings `better-sqlite3` as a peer dep. The override below prevents pnpm from creating two instances of drizzle-orm.

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

- Dashboard: port 5000 (Replit mandates port 5000 for webview)
- API server: port 8080
- Vite proxy (`vite.config.ts`): `/api` → `http://localhost:8080`

## MongoDB Config

- `MONGODB_URL` env var used as fallback for all MongoDB connections
- Database name: `Joining_links`, collection: `tg_sessions`
- `mongoSessionBackup.ts` reads url/dbName from settings table first, falls back to env var
- `importAccountsFromMongo()` creates new PostgreSQL accounts from MongoDB data (not just restores)

## Settings ALLOWED_KEYS

`settings.ts` PUT endpoint has an explicit `ALLOWED_KEYS` set. Current set: `telegram_api_id`, `telegram_api_hash`, `auto_sync_interval_minutes`, `active_start_hour`, `ai_filter_enabled`, `mongo_backup_url`, `mongo_backup_db`.

## Engine Account Rotation (Critical)

- `allActive` accounts query MUST have `.orderBy(asc(accountsTable.id))`
- `flood_wait` accounts auto-reset at start of each tick
- `usable` filter only checks `joinedToday >= dailyLimit`

## Auth Flow (Telegram OTP)

In-memory `Map<phone, PendingSession>` holds TelegramClient mid-flow. Sessions auto-expire after 10 min. After verify, `client.exportSession()` string saved to `accounts.session_string`. No temp files.

## Engine

- Auto-resumes on restart if `bot_state.running = true` in DB
- Blackout: 2 AM – 8 AM no joins (configurable)
- Per-account safe interval: ~1029s (~17.2 min), ±25% jitter
- Error handling: flood_wait / peer_flood / channels_limit / already_joined / auth_revoked / account_banned / link_failed / unknown
