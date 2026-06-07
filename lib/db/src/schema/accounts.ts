import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const accountsTable = pgTable("accounts", {
  id: serial("id").primaryKey(),
  phone: text("phone").notNull().unique(),
  label: text("label"),
  status: text("status").notNull().default("active"),
  joinedCount: integer("joined_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  dailyLimit: integer("daily_limit").notNull().default(20),
  currentDelay: integer("current_delay").notNull().default(300),
  floodWaitUntil: timestamp("flood_wait_until", { withTimezone: true }),
  sessionFile: text("session_file"),
  isPremium: boolean("is_premium").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAccountSchema = createInsertSchema(accountsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type Account = typeof accountsTable.$inferSelect;
