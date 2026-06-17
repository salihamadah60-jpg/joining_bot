import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import app from "./app";
import foldersRouter from "./routes/folders";
import { logger } from "./lib/logger";
import { engineInit } from "./lib/telegramEngine";
import { cleanupIdleClients } from "./lib/clientPool";
import { startAutoSync } from "./lib/mongoSync";
import { startInviteRequestChecker } from "./lib/inviteRequestChecker";
import { startLeaveEngine, startLeaveQueueProcessor } from "./lib/leaveEngine";
import { initMongo } from "@workspace/db";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// ── Single-instance lock ─────────────────────────────────────────────────────
// Prevents two API server processes from connecting to Telegram simultaneously,
// which causes AUTH_KEY_DUPLICATED and session disruption.
const LOCK_FILE = `/tmp/api-server-${port}.lock`;

function acquireLock(): boolean {
  try {
    if (existsSync(LOCK_FILE)) {
      const raw = readFileSync(LOCK_FILE, "utf8").trim();
      const existingPid = parseInt(raw, 10);
      if (!Number.isNaN(existingPid) && existingPid !== process.pid) {
        try {
          // Signal 0 = check if process exists without sending a real signal
          process.kill(existingPid, 0);
          // Process is alive — another instance is already running
          logger.error(
            { existingPid, port },
            "DUPLICATE INSTANCE DETECTED — another API server is already running on this port. " +
            "Exiting immediately to protect Telegram sessions from AUTH_KEY_DUPLICATED. " +
            "Stop the other instance first."
          );
          return false;
        } catch {
          // Process no longer exists — stale lock file, remove it
          logger.warn({ existingPid }, "Removing stale lock file from dead process");
          unlinkSync(LOCK_FILE);
        }
      }
    }
    // Atomic exclusive create — only ONE process can succeed (O_EXCL semantics).
    // If two processes race here, only one writes the file; the other gets EEXIST.
    writeFileSync(LOCK_FILE, String(process.pid), { flag: "wx" });
    logger.debug({ pid: process.pid, lockFile: LOCK_FILE }, "Instance lock acquired");
    return true;
  } catch (err: any) {
    if (err?.code === "EEXIST") {
      // Another process won the race and just created the lock — re-check it
      try {
        const raw = readFileSync(LOCK_FILE, "utf8").trim();
        const existingPid = parseInt(raw, 10);
        if (!Number.isNaN(existingPid)) {
          try {
            process.kill(existingPid, 0);
            logger.error(
              { existingPid, port },
              "DUPLICATE INSTANCE DETECTED (race) — another API server is already running. " +
              "Exiting to protect Telegram sessions from AUTH_KEY_DUPLICATED."
            );
            return false;
          } catch {
            // That PID died between write and our check — remove stale lock and retry once
            unlinkSync(LOCK_FILE);
            writeFileSync(LOCK_FILE, String(process.pid), { flag: "wx" });
            logger.debug({ pid: process.pid }, "Instance lock acquired after removing stale (race)");
            return true;
          }
        }
      } catch {
        // Lock file disappeared between EEXIST and our read — treat as won
        logger.warn({}, "Lock file vanished during race — proceeding");
        return true;
      }
      return false;
    }
    // Other FS error — warn but allow startup (fail open)
    logger.warn({ err }, "Could not acquire instance lock — proceeding anyway");
    return true;
  }
}

function releaseLock(): void {
  try {
    if (existsSync(LOCK_FILE)) {
      const raw = readFileSync(LOCK_FILE, "utf8").trim();
      const pid = parseInt(raw, 10);
      // Only remove our own lock
      if (pid === process.pid) {
        unlinkSync(LOCK_FILE);
        logger.debug({ pid: process.pid }, "Instance lock released");
      }
    }
  } catch {}
}

// Check lock before doing anything Telegram-related
// Exit code 0 = intentional graceful exit (not an error), so the workflow
// shows as "finished" rather than "failed" when a legitimate duplicate is found.
if (!acquireLock()) {
  process.exit(0);
}

// Release lock on any kind of shutdown
process.on("exit", releaseLock);
process.on("SIGTERM", () => { releaseLock(); process.exit(0); });
process.on("SIGINT",  () => { releaseLock(); process.exit(0); });
process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception — releasing lock and exiting");
  releaseLock();
  process.exit(1);
});

// ── MongoDB init with background retry (non-fatal) ──────────────────────────
async function initMongoWithRetry(attempt = 1): Promise<void> {
  try {
    await initMongo();
    logger.info("MongoDB initialized (indexes + bot_state singleton ensured)");

    try {
      await engineInit();
    } catch (e) {
      logger.error({ err: e }, "Failed to initialize bot engine");
    }

    app.use("/api", foldersRouter);
    startAutoSync();
    startInviteRequestChecker();
    startLeaveEngine();
    await startLeaveQueueProcessor();

    setInterval(() => {
      cleanupIdleClients().catch((e) =>
        logger.error({ err: e }, "Client cleanup error"),
      );
    }, 30 * 60_000);
  } catch (e) {
    const delaySecs = Math.min(30 * attempt, 120);
    logger.error(
      { err: e, attempt, retryInSecs: delaySecs },
      "Failed to initialize MongoDB — retrying",
    );
    setTimeout(() => initMongoWithRetry(attempt + 1), delaySecs * 1000);
  }
}

const server = app.listen(port, () => {
  logger.info({ port }, "Server listening");
  initMongoWithRetry();
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    // Graceful exit — another server already owns this port.
    // Exit code 0 so the workflow shows "finished" not "failed".
    logger.warn(
      { port },
      `Port ${port} is already in use — another API server instance is running. ` +
      "Exiting gracefully (sessions and Telegram connections are safe)."
    );
    releaseLock();
    process.exit(0);
  } else {
    logger.error({ err }, "Server error");
    releaseLock();
    process.exit(1);
  }
});
