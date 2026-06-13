---
name: API Server Fast Startup
description: How to run the API server in dev mode without slow esbuild rebuild every restart
---

# API Server Fast Startup

## The Rule
The `dev` script in `artifacts/api-server/package.json` MUST use `pnpm exec tsx src/index.ts`, NOT `pnpm run build && pnpm run start`.

**Current correct script:**
```json
"dev": "NODE_ENV=development pnpm exec tsx src/index.ts"
```

**Why:** The old script ran a full esbuild bundle (~2s build + heavy cold-start overhead) on every restart. Using `tsx` (TypeScript executor) starts the server in ~2–3 seconds total with no build step, saving minutes per session.

**How to apply:** Any time a new chat session touches the API server dev script, verify it uses `tsx`, not `build`. If it ever gets reverted to the esbuild pattern, change it back immediately.

## tsx dependency
`tsx` must be a `devDependency` in `artifacts/api-server/package.json` with `"tsx": "catalog:"`. After any `package.json` change, run `pnpm install` once so the binary symlink appears at `artifacts/api-server/node_modules/.bin/tsx`. Without this, `pnpm exec tsx` will fail with "Command not found".

## Workflows
- **Dashboard** (`Start application`): `pnpm --filter @workspace/dashboard run dev` → port 5000, outputType webview
- **API Server** (`artifacts/api-server: API Server`): managed automatically by Replit artifact system using the `dev` script above → port 8080, outputType console
- Do NOT create a separate manual "API Server" workflow — Replit manages it via the artifact.

## Required Secrets
These must be present before the API server can connect:
- `MONGODB_URL` — MongoDB connection string
- `TELEGRAM_API_ID` — from https://my.telegram.org/apps
- `TELEGRAM_API_HASH` — from https://my.telegram.org/apps
