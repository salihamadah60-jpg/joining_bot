import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const groupLinksTable = pgTable("group_links", {
  id: serial("id").primaryKey(),
  url: text("url").notNull().unique(),
  status: text("status").notNull().default("pending"),
  failReason: text("fail_reason"),
  groupTitle: text("group_title"),
  groupType: text("group_type"),
  source: text("source"),
  usedByAccountId: integer("used_by_account_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
});

export const insertGroupLinkSchema = createInsertSchema(groupLinksTable).omit({ id: true, createdAt: true });
export type InsertGroupLink = z.infer<typeof insertGroupLinkSchema>;
export type GroupLink = typeof groupLinksTable.$inferSelect;
