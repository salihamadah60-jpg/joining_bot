/**
 * EVENT BUS — Real-time Notifications + Sync Progress
 * A simple in-process EventEmitter that the bot engine + sync publish to,
 * and SSE clients subscribe to.
 */

import { EventEmitter } from "events";

export type BotEventType =
  | "account_banned"
  | "account_needs_auth"
  | "flood_wait_long"
  | "channels_limit"
  | "channel_detected"
  | "links_exhausted"
  | "join_success"
  | "join_failed"
  | "engine_started"
  | "engine_stopped"
  | "sync_progress"
  | "sync_complete"
  | "sync_error";

export interface BotEvent {
  type: BotEventType;
  message: string;
  accountPhone?: string;
  linkUrl?: string;
  waitSeconds?: number;
  timestamp: string;
  // Sync-specific fields
  collectionId?: string;
  collectionName?: string;
  total?: number;
  processed?: number;
  synced?: number;
  duplicates?: number;
  errors?: number;
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

  getRecent(n = 20): BotEvent[] {
    return this.recent.slice(-n);
  }

  publish(event: BotEvent): void {
    this.emit("bot_event", event);
  }
}

export const eventBus = new BotEventBus();
eventBus.setMaxListeners(200);
