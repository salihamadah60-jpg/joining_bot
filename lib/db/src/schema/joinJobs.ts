import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const joinJobsTable = pgTable("join_jobs", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull(),
  linkId: integer("link_id").notNull(),
  status: text("status").notNull(),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertJoinJobSchema = createInsertSchema(joinJobsTable).omit({ id: true, createdAt: true });
export type InsertJoinJob = z.infer<typeof insertJoinJobSchema>;
export type JoinJob = typeof joinJobsTable.$inferSelect;
