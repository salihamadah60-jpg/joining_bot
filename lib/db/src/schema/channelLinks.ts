import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const channelLinksTable = pgTable("channel_links", {
  id: serial("id").primaryKey(),
  url: text("url").notNull().unique(),
  title: text("title"),
  detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertChannelLinkSchema = createInsertSchema(channelLinksTable).omit({ id: true, detectedAt: true });
export type InsertChannelLink = z.infer<typeof insertChannelLinkSchema>;
export type ChannelLink = typeof channelLinksTable.$inferSelect;
