/**
 * SSE EVENTS ROUTE — P2-5: Real-time Notifications
 *
 * GET /api/events — Server-Sent Events stream.
 * Dashboard subscribes and gets pushed notifications for critical bot events.
 */

import { Router, type IRouter } from "express";
import { eventBus } from "../lib/eventBus.js";

const router: IRouter = Router();

router.get("/events", (req, res): void => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Send recent events so the client catches up immediately
  const recent = eventBus.getRecent(20);
  for (const event of recent) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  // Send a keepalive comment every 25 seconds to prevent proxy timeouts
  const keepalive = setInterval(() => {
    try {
      res.write(": keepalive\n\n");
    } catch {
      clearInterval(keepalive);
    }
  }, 25_000);

  // Forward new events as they arrive
  const onEvent = (event: unknown) => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      // Client disconnected
    }
  };

  eventBus.on("bot_event", onEvent);

  // Cleanup on disconnect
  req.on("close", () => {
    clearInterval(keepalive);
    eventBus.off("bot_event", onEvent);
  });
});

export default router;
