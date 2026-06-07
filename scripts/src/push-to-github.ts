/**
 * PUSH PROJECT TO GITHUB
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run push-github
 *
 * Required env vars:
 *   GITHUB_TOKEN   — Personal access token with `repo` scope
 *   GITHUB_REPO    — Target repo name (e.g. "my-org/telegram-bot-manager")
 *                    Leave blank to auto-create: uses repl name
 *
 * What it does:
 *   1. Initializes git if not already initialized
 *   2. Creates the GitHub repo via API if it doesn't exist
 *   3. Sets the remote origin
 *   4. Adds all files, commits, and force-pushes to main
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function run(cmd: string, opts?: { cwd?: string; silent?: boolean }): string {
  try {
    const out = execSync(cmd, {
      cwd: opts?.cwd ?? ROOT,
      encoding: "utf8",
      stdio: opts?.silent ? ["pipe", "pipe", "pipe"] : ["inherit", "pipe", "pipe"],
    });
    return (out ?? "").trim();
  } catch (e: any) {
    throw new Error(`Command failed: ${cmd}\n${e.stderr ?? e.message}`);
  }
}

async function apiRequest(
  path: string,
  method: "GET" | "POST" | "PATCH",
  token: string,
  body?: object
): Promise<any> {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok && res.status !== 422) {
    throw new Error(`GitHub API error ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function main() {
  const token = process.env["GITHUB_TOKEN"];
  if (!token) {
    console.error("❌ GITHUB_TOKEN env var is required");
    process.exit(1);
  }

  // Get authenticated user
  console.log("🔍 Getting GitHub user info...");
  const user = await apiRequest("/user", "GET", token);
  const username = user.login as string;
  console.log(`   Authenticated as: @${username}`);

  // Determine repo name
  let repoFullName = process.env["GITHUB_REPO"] ?? "";
  if (!repoFullName) {
    const replName = process.env["REPL_SLUG"] ?? "telegram-bot-manager";
    repoFullName = `${username}/${replName}`;
  }
  const [owner, repoName] = repoFullName.split("/");

  // Create repo if it doesn't exist
  console.log(`\n📦 Ensuring repo ${repoFullName} exists...`);
  const checkRes = await fetch(`https://api.github.com/repos/${repoFullName}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
  });

  if (checkRes.status === 404) {
    console.log("   Creating new repository...");
    await apiRequest(
      owner === username ? "/user/repos" : `/orgs/${owner}/repos`,
      "POST",
      token,
      {
        name: repoName,
        description: "Telegram multi-account bot manager with web dashboard",
        private: true,
        auto_init: false,
      }
    );
    console.log("   ✅ Repository created");
  } else {
    console.log("   ✅ Repository already exists");
  }

  const remoteUrl = `https://${token}@github.com/${repoFullName}.git`;

  // Init git if needed
  if (!existsSync(path.join(ROOT, ".git"))) {
    console.log("\n🔧 Initializing git...");
    run("git init -b main");
  }

  // Write .gitignore if missing
  const gitignorePath = path.join(ROOT, ".gitignore");
  if (!existsSync(gitignorePath)) {
    const { writeFileSync } = await import("fs");
    writeFileSync(
      gitignorePath,
      [
        "node_modules/",
        "dist/",
        ".tsbuildinfo",
        "*.tsbuildinfo",
        "*.db",
        "*.db-wal",
        "*.db-shm",
        "sessions/",
        ".env",
        ".env.local",
        "*.map",
      ].join("\n") + "\n"
    );
    console.log("   ✅ .gitignore created");
  }

  // Set remote
  console.log("\n🔗 Setting git remote...");
  try {
    run("git remote remove origin", { silent: true });
  } catch (_) {}
  run(`git remote add origin ${remoteUrl}`);

  // Configure git identity (needed in CI-like envs)
  try {
    run("git config user.email bot@replit.com", { silent: true });
    run("git config user.name Replit-Bot", { silent: true });
  } catch (_) {}

  // Stage, commit, push
  console.log("\n📝 Staging all files...");
  run("git add -A");

  let hasChanges = true;
  try {
    run("git diff --cached --exit-code --quiet", { silent: true });
    hasChanges = false;
  } catch (_) {}

  if (hasChanges) {
    run(`git commit -m "chore: sync from Replit — $(date -u '+%Y-%m-%d %H:%M UTC')"`);
    console.log("   ✅ Committed changes");
  } else {
    console.log("   ℹ️  No new changes to commit");
  }

  console.log(`\n🚀 Pushing to https://github.com/${repoFullName}...`);
  run("git push -u origin main --force");
  console.log(`\n✅ Done! Repo: https://github.com/${repoFullName}`);
}

main().catch((e) => {
  console.error("❌ Fatal:", e.message);
  process.exit(1);
});
