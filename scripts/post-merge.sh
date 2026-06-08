#!/bin/bash
set -e

# Skip full install if node_modules already exists — better-sqlite3 takes
# over 60s to compile from source which exceeds the 20s post-merge timeout.
# Use --ignore-scripts to avoid recompiling native modules on every merge.
if [ -d "node_modules" ]; then
  pnpm install --frozen-lockfile --ignore-scripts
else
  pnpm install --frozen-lockfile
fi

# Push DB schema (non-interactive, uses drizzle-kit push --force)
pnpm --filter @workspace/db run push-force 2>/dev/null || pnpm --filter @workspace/db run push
