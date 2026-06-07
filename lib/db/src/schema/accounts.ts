import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const accountsTable = pgTable("accounts", {
  id: serial("id").primaryKey(),
  phone: text("phone").notNull().unique(),
  label: text("label"),
  status: text("status").notNull().default("active"),
  sessionString: text("session_string"),
  joinedCount: integer("joined_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  joinedToday: integer("joined_today").notNull().default(0),
  dailyLimit: integer("daily_limit").notNull().default(85),
  currentDelay: integer("current_delay").notNull().default(1030),
  floodWaitUntil: timestamp("flood_wait_until", { withTimezone: true }),
  lastJoinAt: timestamp("last_join_at", { withTimezone: true }),
  nextJoinAllowedAt: timestamp("next_join_allowed_at", { withTimezone: true }),
  dailyResetAt: timestamp("daily_reset_at", { withTimezone: true }),
  channelsCount: integer("channels_count").notNull().default(0),
  isPremium: boolean("is_premium").notNull().default(false),
  // P2-1: Device fingerprint — unique per account to avoid bot detection
  deviceModel: text("device_model"),
  systemVersion: text("system_version"),
  appVersion: text("app_version"),
  systemLangCode: text("system_lang_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAccountSchema = createInsertSchema(accountsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type Account = typeof accountsTable.$inferSelect;
