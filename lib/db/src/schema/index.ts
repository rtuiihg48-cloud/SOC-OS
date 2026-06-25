import { pgTable, serial, text, integer, timestamp, boolean, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─── Tenants ──────────────────────────────────────────────────────────────────
// Multi-tenant SaaS foundation. Every event, rule, and alert is scoped to a tenant.
export const tenantsTable = pgTable("tenants", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  apiKey: text("api_key").notNull(),
  plan: text("plan").notNull().default("starter"), // starter | pro | enterprise
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Rules ────────────────────────────────────────────────────────────────────
// Configurable SIEM rules — operators define patterns, boosts, and forced actions.
// This is the "no-code rule engine" that makes SOC-OS a product, not just a script.
export const rulesTable = pgTable("rules", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenantsTable.id),
  name: text("name").notNull(),
  description: text("description"),
  matchPattern: text("match_pattern").notNull(),
  scoreBoost: integer("score_boost").notNull().default(0),
  forceAction: text("force_action"),   // WARN | ISOLATE | null
  severity: text("severity").notNull().default("medium"), // low | medium | high | critical
  enabled: boolean("enabled").notNull().default(true),
  hitCount: integer("hit_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Correlations ─────────────────────────────────────────────────────────────
// Attack chain detection results. When the correlation engine finds a multi-step
// attack pattern (e.g. scan → exploit → exfil), it creates a correlation record.
export const correlationsTable = pgTable("correlations", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenantsTable.id),
  threatType: text("threat_type").notNull(),   // CHAIN_ATTACK | CREDENTIAL_STUFFING | APT_SEQUENCE | etc.
  severity: text("severity").notNull(),         // LOW | MEDIUM | HIGH | CRITICAL
  confidence: real("confidence").notNull(),     // 0.0–1.0
  summary: text("summary").notNull(),
  eventIds: text("event_ids").notNull(),        // JSON array of correlated event IDs
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Security Events ─────────────────────────────────────────────────────────
export const securityEventsTable = pgTable("security_events", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenantsTable.id),
  event: text("event").notNull(),
  score: integer("score").notNull(),
  action: text("action").notNull(),
  status: text("status").notNull().default("NEW"),
  tactic: text("tactic"),
  technique: text("technique"),
  techniqueId: text("technique_id"),
  velocityFlag: boolean("velocity_flag").notNull().default(false),
  severity: text("severity").notNull().default("LOW"),   // LOW | MEDIUM | HIGH | CRITICAL
  ruleMatches: text("rule_matches"),                      // JSON array of matched rule IDs
  correlationId: integer("correlation_id").references(() => correlationsTable.id),
  nodeId: text("node_id").notNull(),
  hash: text("hash").notNull(),
  prevHash: text("prev_hash").notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow().notNull(),
  cpuUsage: integer("cpu_usage"),
  memUsage: integer("mem_usage"),
});

// ─── Patches ─────────────────────────────────────────────────────────────────
export const patchesTable = pgTable("patches", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenantsTable.id),
  attack: text("attack").notNull(),
  fix: text("fix").notNull(),
  tactic: text("tactic"),
  appliedAt: timestamp("applied_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Derived types ────────────────────────────────────────────────────────────
export const insertTenantSchema = createInsertSchema(tenantsTable).omit({ id: true, createdAt: true });
export type InsertTenant = z.infer<typeof insertTenantSchema>;
export type Tenant = typeof tenantsTable.$inferSelect;

export const insertRuleSchema = createInsertSchema(rulesTable).omit({ id: true, createdAt: true, hitCount: true });
export type InsertRule = z.infer<typeof insertRuleSchema>;
export type Rule = typeof rulesTable.$inferSelect;

export const insertCorrelationSchema = createInsertSchema(correlationsTable).omit({ id: true, createdAt: true });
export type InsertCorrelation = z.infer<typeof insertCorrelationSchema>;
export type Correlation = typeof correlationsTable.$inferSelect;

export const insertSecurityEventSchema = createInsertSchema(securityEventsTable).omit({ id: true, timestamp: true });
export type InsertSecurityEvent = z.infer<typeof insertSecurityEventSchema>;
export type SecurityEvent = typeof securityEventsTable.$inferSelect;

export const insertPatchSchema = createInsertSchema(patchesTable).omit({ id: true, appliedAt: true });
export type InsertPatch = z.infer<typeof insertPatchSchema>;
export type Patch = typeof patchesTable.$inferSelect;
