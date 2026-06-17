import app from "./app";
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

// ── MongoDB init with background retry (non-fatal) ──────────────────────────
async function initMongoWithRetry(attempt = 1): Promise<void> {
  try {
    await initMongo();
    logger.info("MongoDB initialized (indexes + bot_state singleton ensured)");

    // Only start engine + sync after MongoDB is ready
    try {
      await engineInit();
    } catch (e) {
      logger.error({ err: e }, "Failed to initialize bot engine");
    }

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

app.listen(port, () => {
  logger.info({ port }, "Server listening");
  initMongoWithRetry();
});
