import { pgTable, serial, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const securityEventsTable = pgTable("security_events", {
  id: serial("id").primaryKey(),
  event: text("event").notNull(),
  score: integer("score").notNull(),
  action: text("action").notNull(),
  status: text("status").notNull().default("NEW"),
  tactic: text("tactic"),
  technique: text("technique"),
  techniqueId: text("technique_id"),
  velocityFlag: boolean("velocity_flag").notNull().default(false),
  nodeId: text("node_id").notNull(),
  hash: text("hash").notNull(),
  prevHash: text("prev_hash").notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow().notNull(),
  cpuUsage: integer("cpu_usage"),
  memUsage: integer("mem_usage"),
});

export const patchesTable = pgTable("patches", {
  id: serial("id").primaryKey(),
  attack: text("attack").notNull(),
  fix: text("fix").notNull(),
  tactic: text("tactic"),
  appliedAt: timestamp("applied_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertSecurityEventSchema = createInsertSchema(securityEventsTable).omit({ id: true, timestamp: true });
export type InsertSecurityEvent = z.infer<typeof insertSecurityEventSchema>;
export type SecurityEvent = typeof securityEventsTable.$inferSelect;

export const insertPatchSchema = createInsertSchema(patchesTable).omit({ id: true, appliedAt: true });
export type InsertPatch = z.infer<typeof insertPatchSchema>;
export type Patch = typeof patchesTable.$inferSelect;
