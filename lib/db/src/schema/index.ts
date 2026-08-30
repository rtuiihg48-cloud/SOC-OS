import { pgTable, serial, text, integer, timestamp, boolean, real, jsonb, index, check, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
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

// ─── DNA / Knowledge Memory ──────────────────────────────────────────────────
// Predictions are immutable observations. Verification is appended separately
// so the original prediction remains available for audits and future training.
export const dnaPredictionsTable = pgTable("dna_predictions", {
  id: serial("id").primaryKey(),
  cycleId: text("cycle_id").notNull(),
  tenantId: integer("tenant_id").references(() => tenantsTable.id),
  attackFamily: text("attack_family").notNull(),
  scenario: text("scenario").notNull(),
  tactic: text("tactic"),
  technique: text("technique"),
  techniqueId: text("technique_id"),
  riskScore: integer("risk_score").notNull(),
  riskLevel: text("risk_level").notNull(),
  confidence: real("confidence").notNull(),
  predictedAction: text("predicted_action").notNull(),
  proposedDefense: text("proposed_defense"),
  predictedDefenseSucceeded: boolean("predicted_defense_succeeded").notNull(),
  predictedResidualRisk: integer("predicted_residual_risk").notNull(),
  predictedVulnerability: text("predicted_vulnerability"),
  telemetrySnapshot: jsonb("telemetry_snapshot").$type<Record<string, number | string | boolean>>().notNull(),
  historyFeatures: jsonb("history_features").$type<Record<string, number>>().notNull(),
  observerNote: text("observer_note").notNull(),
  modelVersion: text("model_version").notNull(),
  predictionStatus: text("prediction_status").notNull().default("predicted"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("dna_predictions_tenant_id_idx").on(table.tenantId),
  index("dna_predictions_family_created_at_idx").on(table.attackFamily, table.createdAt),
  index("dna_predictions_created_at_idx").on(table.createdAt),
  check("dna_predictions_confidence_check", sql`${table.confidence} >= 0 AND ${table.confidence} <= 1`),
  check("dna_predictions_predicted_residual_risk_check", sql`${table.predictedResidualRisk} >= 0`),
  check("dna_predictions_prediction_status_check", sql`${table.predictionStatus} = 'predicted'`),
]);

export const dnaOutcomesTable = pgTable("dna_outcomes", {
  id: serial("id").primaryKey(),
  predictionId: integer("prediction_id").notNull().references(() => dnaPredictionsTable.id, { onDelete: "restrict" }),
  source: text("source").notNull().default("simulation"),
  verificationStatus: text("verification_status").notNull(),
  defenseAction: text("defense_action"),
  defenseSucceeded: boolean("defense_succeeded").notNull(),
  residualRisk: integer("residual_risk").notNull(),
  vulnerabilityPattern: text("vulnerability_pattern"),
  reflection: text("reflection").notNull(),
  details: jsonb("details").$type<Record<string, number | string | boolean | null>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("dna_outcomes_prediction_id_idx").on(table.predictionId),
  index("dna_outcomes_status_created_at_idx").on(table.verificationStatus, table.createdAt),
  check("dna_outcomes_verification_status_check", sql`${table.verificationStatus} IN ('verified', 'rejected', 'inconclusive')`),
  check("dna_outcomes_residual_risk_check", sql`${table.residualRisk} >= 0`),
]);

export const dnaAttackLinksTable = pgTable("dna_attack_links", {
  id: serial("id").primaryKey(),
  fromPredictionId: integer("from_prediction_id").notNull().references(() => dnaPredictionsTable.id, { onDelete: "restrict" }),
  toPredictionId: integer("to_prediction_id").notNull().references(() => dnaPredictionsTable.id, { onDelete: "restrict" }),
  linkType: text("link_type").notNull(),
  confidence: real("confidence").notNull(),
  evidence: jsonb("evidence").$type<Record<string, number | string | boolean | null>>().notNull(),
  explanation: text("explanation").notNull(),
  modelVersion: text("model_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("dna_attack_links_pair_type_uidx").on(table.fromPredictionId, table.toPredictionId, table.linkType),
  index("dna_attack_links_from_prediction_idx").on(table.fromPredictionId),
  index("dna_attack_links_to_prediction_idx").on(table.toPredictionId),
  index("dna_attack_links_type_created_at_idx").on(table.linkType, table.createdAt),
  check("dna_attack_links_confidence_check", sql`${table.confidence} >= 0 AND ${table.confidence} <= 1`),
  check("dna_attack_links_type_check", sql`${table.linkType} IN ('sequence', 'same_pattern', 'same_technique', 'shared_vulnerability')`),
  check("dna_attack_links_distinct_predictions_check", sql`${table.fromPredictionId} <> ${table.toPredictionId}`),
]);

export const dnaPredictionLayerObservationsTable = pgTable("dna_prediction_layer_observations", {
  id: serial("id").primaryKey(),
  predictionId: integer("prediction_id").notNull().references(() => dnaPredictionsTable.id, { onDelete: "restrict" }),
  layerName: text("layer_name").notNull(),
  output: jsonb("output").$type<Record<string, unknown>>().notNull(),
  confidence: real("confidence").notNull(),
  modelVersion: text("model_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("dna_prediction_layer_observations_prediction_layer_uidx").on(table.predictionId, table.layerName),
  index("dna_prediction_layer_observations_prediction_idx").on(table.predictionId),
  index("dna_prediction_layer_observations_layer_created_at_idx").on(table.layerName, table.createdAt),
  check("dna_prediction_layer_observations_layer_name_check", sql`${table.layerName} IN ('markov', 'quantum')`),
  check("dna_prediction_layer_observations_confidence_check", sql`${table.confidence} >= 0 AND ${table.confidence} <= 1`),
]);

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

export const insertDnaPredictionSchema = createInsertSchema(dnaPredictionsTable).omit({ id: true, createdAt: true });
export type InsertDnaPrediction = z.infer<typeof insertDnaPredictionSchema>;
export type DnaPrediction = typeof dnaPredictionsTable.$inferSelect;

export const insertDnaOutcomeSchema = createInsertSchema(dnaOutcomesTable).omit({ id: true, createdAt: true });
export type InsertDnaOutcome = z.infer<typeof insertDnaOutcomeSchema>;
export type DnaOutcome = typeof dnaOutcomesTable.$inferSelect;

export const insertDnaAttackLinkSchema = createInsertSchema(dnaAttackLinksTable).omit({ id: true, createdAt: true });
export type InsertDnaAttackLink = z.infer<typeof insertDnaAttackLinkSchema>;
export type DnaAttackLink = typeof dnaAttackLinksTable.$inferSelect;

export const insertDnaPredictionLayerObservationSchema = createInsertSchema(dnaPredictionLayerObservationsTable).omit({ id: true, createdAt: true });
export type InsertDnaPredictionLayerObservation = z.infer<typeof insertDnaPredictionLayerObservationSchema>;
export type DnaPredictionLayerObservation = typeof dnaPredictionLayerObservationsTable.$inferSelect;
