/**
 * EVENT BUS — P2-5: Real-time Notifications
 *
 * A simple in-process EventEmitter that the bot engine publishes to,
 * and SSE clients subscribe to. No external broker needed.
 */

import { EventEmitter } from "events";

export type BotEventType =
  | "account_banned"
  | "account_needs_auth"
  | "flood_wait_long"
  | "channels_limit"
  | "links_exhausted"
  | "join_success"
  | "join_failed"
  | "engine_started"
  | "engine_stopped";

export interface BotEvent {
  type: BotEventType;
  message: string;
  accountPhone?: string;
  linkUrl?: string;
  waitSeconds?: number;
  timestamp: string;
}

class BotEventBus extends EventEmitter {
  private recent: BotEvent[] = [];
  private readonly MAX_RECENT = 50;

  emit(event: "bot_event", data: BotEvent): boolean;
  emit(event: string, ...args: unknown[]): boolean;
  emit(event: string, ...args: unknown[]): boolean {
    if (event === "bot_event") {
      const data = args[0] as BotEvent;
      this.recent.push(data);
      if (this.recent.length > this.MAX_RECENT) this.recent.shift();
    }
    return super.emit(event, ...args);
  }

  /** Return the last N events (for new SSE connections to catch up). */
  getRecent(n = 20): BotEvent[] {
    return this.recent.slice(-n);
  }

  /** Publish a new event to all SSE subscribers. */
  publish(event: BotEvent): void {
    this.emit("bot_event", event);
  }
}

export const eventBus = new BotEventBus();
eventBus.setMaxListeners(200); // allow many SSE connections
