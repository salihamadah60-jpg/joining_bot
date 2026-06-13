# Telegram Multi-Account Bot Manager

إدارة حسابات تيليجرام متعددة للانضمام تلقائياً لمجموعات طبية وبحثية وتعليمية مع لوحة تحكم ويب.

## Run & Operate

- Dashboard: `pnpm --filter @workspace/dashboard run dev` → port 5000 (webview)
- API Server: `pnpm --filter @workspace/api-server run dev` → port 8080 (console) — uses `tsx`, starts in ~3s, NO build step
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages (for production only)
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/scripts run push-github` — push project to GitHub repo
- Required secrets: `MONGODB_URL`, `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`

## ⚠️ API Server dev script — MUST use tsx
The `dev` script in `artifacts/api-server/package.json` MUST be:
```
"dev": "NODE_ENV=development pnpm exec tsx src/index.ts"
```
NEVER revert to `pnpm run build && pnpm run start` for dev — that rebuilds the full esbuild bundle on every restart (slow). tsx starts the server in seconds without a build step. After adding tsx to devDependencies, run `pnpm install` once to create the binary symlink.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Telegram: @mtcute/node (MTProto client) + better-sqlite3 (session storage)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (ESM bundle)
- Dashboard: React + Vite + Wouter + Tailwind + shadcn/ui

## Where things live

- `lib/db/src/schema/` — DB schema source of truth (accounts, groupLinks, activityLog, botState, mongoCollections, joinJobs)
- `lib/api-spec/openapi.yaml` — API contract source of truth (generate hooks with codegen command above)
- `artifacts/api-server/src/lib/` — Telegram engine, timing, error handling, client pool
- `artifacts/api-server/src/routes/` — Express routes (accounts, auth, bot, links, jobs, collections)
- `artifacts/api-server/sessions/` — SQLite session files per account (auto-created, gitignored)
- `artifacts/dashboard/src/pages/` — 5-page React dashboard

## Architecture decisions

- **Account safety over speed**: DAILY_LIMIT=85 joins / 18 active hours / account. Safe interval ~17.2 min per account. 2–8 AM blackout. ±25% jitter. See `timing.ts`.
- **@mtcute/node** for Telegram MTProto (replaces GramJS). Session stored in SQLite per phone (`sessions/{phone}.db`) + exported string backed up to DB.
- **drizzle-orm peer conflict fix**: `pnpm-workspace.yaml` has `"drizzle-orm>better-sqlite3": "-"` override to prevent dual drizzle-orm instances caused by @mtcute bringing in better-sqlite3 as a peer.
- **Contract-first API**: All route types come from generated Orval schemas — never write types by hand.
- **Engine auto-resume**: On server restart, `engineInit()` checks `bot_state.running` and resumes automatically if it was running.

## Product

- **Accounts page**: Register Telegram accounts, auth via OTP+2FA from dashboard, see per-account join stats (today/total/channels), pause/resume/delete
- **Dashboard**: Live bot status, today's stats, activity feed, quick start/stop
- **Links page**: View and add group links, see pending/joined/failed status
- **Collections page**: MongoDB collections as link sources (auto-sync)
- **Jobs page**: Per-job join attempt history

## User preferences

- Arabic UI with English tech terms. RTL-friendly.
- Account safety is TOP priority — never sacrifice safety for speed.
- Complete implementation, no placeholder/mock data.
- Explicit failures (never silent fallbacks).

## Gotchas

- `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` MUST be set before the bot can connect. Get them from https://my.telegram.org/apps.
- `better-sqlite3` must be in `onlyBuiltDependencies` in `pnpm-workspace.yaml` AND as a direct dependency in `api-server/package.json` — otherwise it won't build its native module.
- DB migrations: use raw SQL (see `/tmp/migrate.mjs` pattern) instead of `drizzle-kit push` in non-TTY environments.
- After schema changes: run `pnpm --filter @workspace/api-spec run codegen` before typechecking.
- Sessions directory (`artifacts/api-server/sessions/`) is auto-created but gitignored — sessions persist across restarts in dev, but are backed up to DB `session_string` column.
- `pnpm-workspace.yaml` excludes `drizzle-orm>better-sqlite3` to prevent dual drizzle-orm instances — do NOT remove this override.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
