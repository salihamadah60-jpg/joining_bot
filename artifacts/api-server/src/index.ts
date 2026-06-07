import app from "./app";
import { logger } from "./lib/logger";
import { engineInit } from "./lib/telegramEngine";
import { cleanupIdleClients } from "./lib/clientPool";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Initialize the bot engine (resumes if it was running before restart)
  try {
    await engineInit();
  } catch (e) {
    logger.error({ err: e }, "Failed to initialize bot engine");
  }

  // Clean up idle Telegram clients every 30 minutes
  setInterval(() => {
    cleanupIdleClients().catch((e) => logger.error({ err: e }, "Client cleanup error"));
  }, 30 * 60_000);
});
