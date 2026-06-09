/**
 * AUTO-SYNC TO GITHUB
 *
 * Watches for file changes and pushes to GitHub every 5 minutes if there are new commits.
 * Run as a background process alongside the main app.
 *
 * Usage: started automatically by the "Start application" workflow
 */

import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const TOKEN = process.env["GITHUB_TOKEN"];
const REPO = process.env["GITHUB_REPO"] ?? "";

if (!TOKEN) {
  console.log("[auto-sync] No GITHUB_TOKEN — sync disabled");
  process.exit(0);
}

function run(cmd: string): string {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: "utf8", stdio: ["pipe","pipe","pipe"] }).trim();
  } catch (e: any) {
    return e.stderr ?? e.message ?? "";
  }
}

function getRepoUrl(): string {
  const current = run("git remote get-url origin 2>/dev/null");
  if (current && !current.includes("github_pat") && !current.includes(TOKEN!)) {
    // inject token into url
    return current.replace("https://", `https://${TOKEN}@`);
  }
  return current;
}

async function sync() {
  try {
    // Stage all changed files
    run("git add -A");

    // Check if there's anything to commit
    const status = run("git diff --cached --name-only");
    if (!status) {
      console.log(`[auto-sync] ${new Date().toLocaleTimeString()} — no changes`);
      return;
    }

    const timestamp = new Date().toISOString().replace("T", " ").slice(0, 16);
    run(`git commit -m "chore: auto-sync ${timestamp}"`);

    const remote = getRepoUrl();
    if (!remote) {
      console.log("[auto-sync] No git remote configured — skipping push");
      return;
    }

    run(`git push ${remote} HEAD:main --force 2>&1`);
    const changed = status.split("\n").length;
    console.log(`[auto-sync] ✅ ${new Date().toLocaleTimeString()} — pushed ${changed} file(s)`);
  } catch (e: any) {
    console.error(`[auto-sync] ❌ ${e.message}`);
  }
}

console.log("[auto-sync] Started — syncing to GitHub every 5 minutes");
sync(); // run once immediately
setInterval(sync, INTERVAL_MS);
