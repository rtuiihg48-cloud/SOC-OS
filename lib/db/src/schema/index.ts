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

// ─── Node Gateway Traffic Observations ────────────────────────────────────────
// Only normalized flow/heartbeat metadata is retained. Packet payloads and raw
// captures are intentionally not represented by this model.
export const trafficObservationsTable = pgTable("traffic_observations", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenantsTable.id, { onDelete: "restrict" }),
  gatewayId: text("gateway_id").notNull(),
  observationId: text("observation_id").notNull(),
  observationType: text("observation_type").notNull().default("FLOW"),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  protocol: text("protocol").notNull().default("UNKNOWN"),
  direction: text("direction").notNull().default("UNKNOWN"),
  sourceAsset: text("source_asset"),
  destinationAsset: text("destination_asset"),
  sourcePort: integer("source_port"),
  destinationPort: integer("destination_port"),
  bytesOut: integer("bytes_out").notNull().default(0),
  bytesIn: integer("bytes_in").notNull().default(0),
  packets: integer("packets").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  dnsQueryName: text("dns_query_name"),
  tlsServerName: text("tls_server_name"),
  httpHost: text("http_host"),
  heartbeatStatus: text("heartbeat_status"),
  heartbeatLatencyMs: integer("heartbeat_latency_ms"),
  isSynthetic: boolean("is_synthetic").notNull().default(false),
  riskScore: integer("risk_score").notNull().default(0),
  severity: text("severity").notNull().default("LOW"),
  signals: jsonb("signals").$type<string[]>().notNull().default([]),
  recommendedAction: text("recommended_action").notNull().default("ALLOW"),
  analysisVersion: text("analysis_version").notNull().default("traffic-v1"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("traffic_observations_tenant_gateway_observation_uidx").on(sql`coalesce(${table.tenantId}, 0)`, table.gatewayId, table.observationId),
  index("traffic_observations_tenant_observed_idx").on(table.tenantId, table.observedAt),
  index("traffic_observations_action_observed_idx").on(table.recommendedAction, table.observedAt),
  index("traffic_observations_protocol_observed_idx").on(table.protocol, table.observedAt),
  check("traffic_observations_type_check", sql`${table.observationType} IN ('FLOW','HEARTBEAT')`),
  check("traffic_observations_direction_check", sql`${table.direction} IN ('INBOUND','OUTBOUND','INTERNAL','UNKNOWN')`),
  check("traffic_observations_ports_check", sql`(${table.sourcePort} IS NULL OR ${table.sourcePort} BETWEEN 0 AND 65535) AND (${table.destinationPort} IS NULL OR ${table.destinationPort} BETWEEN 0 AND 65535)`),
  check("traffic_observations_counters_check", sql`${table.bytesOut} >= 0 AND ${table.bytesIn} >= 0 AND ${table.packets} >= 0 AND ${table.durationMs} >= 0`),
  check("traffic_observations_score_check", sql`${table.riskScore} BETWEEN 0 AND 100`),
  check("traffic_observations_severity_check", sql`${table.severity} IN ('LOW','MEDIUM','HIGH','CRITICAL')`),
  check("traffic_observations_action_check", sql`${table.recommendedAction} IN ('ALLOW','WARN','ISOLATE')`),
  check("traffic_observations_metadata_only_check", sql`${table.observationType} IN ('FLOW','HEARTBEAT')`),
]);

// ─── Sandbox Quarantine Captures ──────────────────────────────────────────────
// A logical isolation envelope for detected events. It captures evidence and
// explicitly forbids execution; the future container phase must not bypass it.
export const sandboxQuarantinesTable = pgTable("sandbox_quarantines", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => securityEventsTable.id, { onDelete: "restrict" }),
  tenantId: integer("tenant_id").references(() => tenantsTable.id, { onDelete: "restrict" }),
  isolationId: text("isolation_id").notNull(),
  status: text("status").notNull().default("QUARANTINED"),
  shellType: text("shell_type").notNull().default("LOGICAL_QUARANTINE"),
  reason: text("reason").notNull(),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  executionAllowed: boolean("execution_allowed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  releasedAt: timestamp("released_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("sandbox_quarantines_event_id_uidx").on(table.eventId),
  uniqueIndex("sandbox_quarantines_isolation_id_uidx").on(table.isolationId),
  index("sandbox_quarantines_tenant_created_at_idx").on(table.tenantId, table.createdAt),
  index("sandbox_quarantines_status_created_at_idx").on(table.status, table.createdAt),
  check("sandbox_quarantines_status_check", sql`${table.status} IN ('QUARANTINED', 'RELEASED', 'DISCARDED')`),
  check("sandbox_quarantines_shell_type_check", sql`${table.shellType} = 'LOGICAL_QUARANTINE'`),
  check("sandbox_quarantines_execution_disabled_check", sql`${table.executionAllowed} = false`),
]);

// ─── Managed Resources / Self-Healing ─────────────────────────────────────────
// Self-healing is limited to explicit logical resources. It never addresses the
// host filesystem and every restore is backed by a verified immutable snapshot.
export const managedResourcesTable = pgTable("managed_resources", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenantsTable.id, { onDelete: "restrict" }),
  resourceKey: text("resource_key").notNull(),
  location: text("location").notNull(),
  state: jsonb("state").$type<Record<string, unknown>>().notNull(),
  stateHash: text("state_hash").notNull(),
  integrityStatus: text("integrity_status").notNull().default("VERIFIED"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("managed_resources_tenant_key_uidx").on(sql`coalesce(${table.tenantId}, 0)`, table.resourceKey),
  index("managed_resources_integrity_idx").on(table.integrityStatus),
  check("managed_resources_integrity_status_check", sql`${table.integrityStatus} IN ('VERIFIED', 'QUARANTINED', 'RESTORING', 'DEGRADED')`),
]);

export const selfHealingRestorePointsTable = pgTable("self_healing_restore_points", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenantsTable.id, { onDelete: "restrict" }),
  resourceKey: text("resource_key").notNull(),
  location: text("location").notNull(),
  state: jsonb("state").$type<Record<string, unknown>>().notNull(),
  stateHash: text("state_hash").notNull(),
  status: text("status").notNull().default("VERIFIED"),
  source: text("source").notNull().default("managed_resource"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("self_healing_restore_points_resource_created_idx").on(table.tenantId, table.resourceKey, table.createdAt),
  index("self_healing_restore_points_status_idx").on(table.status, table.createdAt),
  check("self_healing_restore_points_status_check", sql`${table.status} IN ('VERIFIED', 'USED', 'REJECTED')`),
]);

export const selfHealingActionsTable = pgTable("self_healing_actions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenantsTable.id, { onDelete: "restrict" }),
  eventId: integer("event_id").references(() => securityEventsTable.id, { onDelete: "restrict" }),
  restorePointId: integer("restore_point_id").references(() => selfHealingRestorePointsTable.id, { onDelete: "restrict" }),
  resourceKey: text("resource_key").notNull(),
  location: text("location").notNull(),
  mode: text("mode").notNull(),
  status: text("status").notNull(),
  previousStateHash: text("previous_state_hash"),
  restoredStateHash: text("restored_state_hash"),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  index("self_healing_actions_resource_created_idx").on(table.tenantId, table.resourceKey, table.createdAt),
  index("self_healing_actions_event_idx").on(table.eventId),
  check("self_healing_actions_mode_check", sql`${table.mode} IN ('PREVIEW', 'APPLY', 'AUTO')`),
  check("self_healing_actions_status_check", sql`${table.status} IN ('READY', 'RESTORED', 'NO_RESTORE_POINT', 'REJECTED', 'FAILED')`),
]);

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

export const agentObserverRunsTable = pgTable("agent_observer_runs", {
  id: serial("id").primaryKey(),
  runId: text("run_id").notNull(),
  tenantId: integer("tenant_id").references(() => tenantsTable.id, { onDelete: "restrict" }),
  taskType: text("task_type").notNull(),
  instruction: text("instruction").notNull(),
  status: text("status").notNull(),
  policy: jsonb("policy").$type<Record<string, unknown>>().notNull(),
  plan: jsonb("plan").$type<unknown[]>().notNull(),
  results: jsonb("results").$type<unknown[]>().notNull(),
  reflection: jsonb("reflection").$type<Record<string, unknown>>().notNull(),
  productionChanged: boolean("production_changed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("agent_observer_runs_run_id_uidx").on(table.runId),
  index("agent_observer_runs_tenant_created_at_idx").on(table.tenantId, table.createdAt),
  index("agent_observer_runs_status_created_at_idx").on(table.status, table.createdAt),
  check("agent_observer_runs_task_type_check", sql`${table.taskType} IN ('analyze_event', 'analyze_system', 'inspect_memory')`),
  check("agent_observer_runs_status_check", sql`${table.status} IN ('blocked', 'completed', 'failed')`),
  check("agent_observer_runs_production_changed_check", sql`${table.productionChanged} = false`),
]);

// ─── Virus Intelligence Database ─────────────────────────────────────────────
export const virusFamiliesTable = pgTable("virus_families", {
  id: serial("id").primaryKey(),
  canonicalName: text("canonical_name").notNull(),
  aliases: text("aliases").array().notNull().default(sql`ARRAY[]::text[]`),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("virus_families_canonical_name_uidx").on(sql`lower(${table.canonicalName})`)]);

export const virusCatalogEntriesTable = pgTable("virus_catalog_entries", {
  id: serial("id").primaryKey(),
  familyId: integer("family_id").references(() => virusFamiliesTable.id, { onDelete: "restrict" }),
  canonicalName: text("canonical_name").notNull(),
  severity: text("severity").notNull(),
  confidence: real("confidence").notNull(),
  status: text("status").notNull().default("ACTIVE"),
  description: text("description"),
  firstSeen: timestamp("first_seen", { withTimezone: true }),
  lastSeen: timestamp("last_seen", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("virus_catalog_entries_family_idx").on(table.familyId),
  index("virus_catalog_entries_severity_status_idx").on(table.severity, table.status),
  check("virus_catalog_entries_severity_check", sql`${table.severity} IN ('LOW','MEDIUM','HIGH','CRITICAL')`),
  check("virus_catalog_entries_confidence_check", sql`${table.confidence} BETWEEN 0 AND 1`),
  check("virus_catalog_entries_status_check", sql`${table.status} IN ('ACTIVE','REVOKED','SUPERSEDED')`),
]);

export const virusFeedSourcesTable = pgTable("virus_feed_sources", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  adapterKind: text("adapter_kind").notNull().default("MANUAL"),
  status: text("status").notNull().default("ACTIVE"),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("virus_feed_sources_name_uidx").on(sql`lower(${table.name})`),
  check("virus_feed_sources_adapter_check", sql`${table.adapterKind} IN ('MANUAL','JSON','STIX','TAXII','CUSTOM')`),
  check("virus_feed_sources_status_check", sql`${table.status} IN ('ACTIVE','PAUSED','DISABLED')`),
]);

export const virusIndicatorsTable = pgTable("virus_indicators", {
  id: serial("id").primaryKey(),
  catalogEntryId: integer("catalog_entry_id").notNull().references(() => virusCatalogEntriesTable.id, { onDelete: "restrict" }),
  sourceId: integer("source_id").references(() => virusFeedSourcesTable.id, { onDelete: "restrict" }),
  indicatorType: text("indicator_type").notNull(),
  normalizedValue: text("normalized_value").notNull(),
  ruleVersion: text("rule_version"),
  confidence: real("confidence").notNull(),
  status: text("status").notNull().default("ACTIVE"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("virus_indicators_type_value_uidx").on(table.indicatorType, table.normalizedValue),
  index("virus_indicators_catalog_idx").on(table.catalogEntryId),
  check("virus_indicators_type_check", sql`${table.indicatorType} IN ('SHA256','BYTE_FINGERPRINT','SIGNATURE')`),
  check("virus_indicators_confidence_check", sql`${table.confidence} BETWEEN 0 AND 1`),
  check("virus_indicators_status_check", sql`${table.status} IN ('ACTIVE','REVOKED','SUPERSEDED')`),
  check("virus_indicators_sha_check", sql`${table.indicatorType} <> 'SHA256' OR ${table.normalizedValue} ~ '^[0-9a-f]{64}$'`),
]);

export const virusFeedImportsTable = pgTable("virus_feed_imports", {
  id: serial("id").primaryKey(),
  sourceId: integer("source_id").notNull().references(() => virusFeedSourcesTable.id, { onDelete: "restrict" }),
  sourceVersion: text("source_version").notNull(),
  cursor: text("cursor"),
  status: text("status").notNull(),
  importedCount: integer("imported_count").notNull().default(0),
  rejectedCount: integer("rejected_count").notNull().default(0),
  deduplicatedCount: integer("deduplicated_count").notNull().default(0),
  errorCode: text("error_code"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("virus_feed_imports_source_version_uidx").on(table.sourceId, table.sourceVersion),
  check("virus_feed_imports_status_check", sql`${table.status} IN ('RUNNING','COMPLETED','PARTIAL','FAILED')`),
]);

export const virusSamplesTable = pgTable("virus_samples", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenantsTable.id, { onDelete: "restrict" }),
  catalogEntryId: integer("catalog_entry_id").references(() => virusCatalogEntriesTable.id, { onDelete: "restrict" }),
  sha256: text("sha256").notNull(),
  objectPath: text("object_path"),
  sizeBytes: integer("size_bytes").notNull(),
  declaredName: text("declared_name"),
  declaredContentType: text("declared_content_type"),
  sourceType: text("source_type").notNull(),
  sourceReference: text("source_reference"),
  status: text("status").notNull().default("QUARANTINED"),
  retentionUntil: timestamp("retention_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("virus_samples_tenant_sha_uidx").on(sql`coalesce(${table.tenantId},0)`, table.sha256),
  index("virus_samples_status_created_idx").on(table.status, table.createdAt),
  check("virus_samples_sha_check", sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
  check("virus_samples_size_check", sql`${table.sizeBytes} BETWEEN 0 AND 52428800`),
  check("virus_samples_source_check", sql`${table.sourceType} IN ('MANUAL','NODE','VIRTUALBOX','FEED')`),
  check("virus_samples_status_check", sql`${table.status} IN ('UPLOADING','QUARANTINED','HASH_VERIFIED','REJECTED','TOMBSTONED')`),
  check("virus_samples_private_path_check", sql`${table.objectPath} IS NULL OR ${table.objectPath} LIKE '/objects/%'`),
]);

export const virusSampleAccessTable = pgTable("virus_sample_access", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenantsTable.id, { onDelete: "restrict" }),
  sampleId: integer("sample_id").notNull().references(() => virusSamplesTable.id, { onDelete: "restrict" }),
  principalRef: text("principal_ref").notNull(),
  capability: text("capability").notNull(),
  purpose: text("purpose").notNull(),
  decision: text("decision").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("virus_sample_access_sample_idx").on(table.sampleId), check("virus_sample_access_decision_check", sql`${table.decision} IN ('ALLOWED','DENIED')`)]);

export const virusMatchesTable = pgTable("virus_matches", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenantsTable.id, { onDelete: "restrict" }),
  eventId: integer("event_id").references(() => securityEventsTable.id, { onDelete: "restrict" }),
  sampleId: integer("sample_id").references(() => virusSamplesTable.id, { onDelete: "restrict" }),
  indicatorId: integer("indicator_id").notNull().references(() => virusIndicatorsTable.id, { onDelete: "restrict" }),
  matchType: text("match_type").notNull(),
  matchedValue: text("matched_value").notNull(),
  confidence: real("confidence").notNull(),
  severity: text("severity").notNull(),
  sourceId: integer("source_id").references(() => virusFeedSourcesTable.id, { onDelete: "restrict" }),
  nodeId: text("node_id"),
  hostId: text("host_id"),
  vmId: text("vm_id"),
  evidenceReference: text("evidence_reference").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("virus_matches_tenant_created_idx").on(table.tenantId, table.createdAt),
  index("virus_matches_event_idx").on(table.eventId),
  check("virus_matches_type_check", sql`${table.matchType} IN ('EXACT_HASH','BYTE_FINGERPRINT','SIGNATURE')`),
  check("virus_matches_confidence_check", sql`${table.confidence} BETWEEN 0 AND 1`),
  check("virus_matches_severity_check", sql`${table.severity} IN ('LOW','MEDIUM','HIGH','CRITICAL')`),
]);

export const virusScanRunsTable = pgTable("virus_scan_runs", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenantsTable.id, { onDelete: "restrict" }),
  sampleId: integer("sample_id").references(() => virusSamplesTable.id, { onDelete: "restrict" }),
  scannerVersion: text("scanner_version").notNull(),
  inputHash: text("input_hash").notNull(),
  status: text("status").notNull(),
  findings: jsonb("findings").$type<Record<string, unknown>>().notNull(),
  correlationId: text("correlation_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [index("virus_scan_runs_sample_idx").on(table.sampleId), check("virus_scan_runs_hash_check", sql`${table.inputHash} ~ '^[0-9a-f]{64}$'`)]);

export const virusDatabaseAuditTable = pgTable("virus_database_audit", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenantsTable.id, { onDelete: "restrict" }),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id"),
  principalRef: text("principal_ref").notNull(),
  outcome: text("outcome").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("virus_database_audit_tenant_created_idx").on(table.tenantId, table.createdAt),
  check("virus_database_audit_outcome_check", sql`${table.outcome} IN ('ALLOWED','DENIED','COMPLETED','FAILED')`),
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

export const insertTrafficObservationSchema = createInsertSchema(trafficObservationsTable).omit({ id: true, createdAt: true, riskScore: true, severity: true, signals: true, recommendedAction: true, analysisVersion: true });
export type InsertTrafficObservation = z.infer<typeof insertTrafficObservationSchema>;
export type TrafficObservation = typeof trafficObservationsTable.$inferSelect;

export const insertSandboxQuarantineSchema = createInsertSchema(sandboxQuarantinesTable).omit({ id: true, createdAt: true });
export type InsertSandboxQuarantine = z.infer<typeof insertSandboxQuarantineSchema>;
export type SandboxQuarantine = typeof sandboxQuarantinesTable.$inferSelect;

export const insertManagedResourceSchema = createInsertSchema(managedResourcesTable).omit({ id: true, updatedAt: true });
export type InsertManagedResource = z.infer<typeof insertManagedResourceSchema>;
export type ManagedResource = typeof managedResourcesTable.$inferSelect;

export const insertSelfHealingRestorePointSchema = createInsertSchema(selfHealingRestorePointsTable).omit({ id: true, createdAt: true, verifiedAt: true });
export type InsertSelfHealingRestorePoint = z.infer<typeof insertSelfHealingRestorePointSchema>;
export type SelfHealingRestorePoint = typeof selfHealingRestorePointsTable.$inferSelect;

export const insertSelfHealingActionSchema = createInsertSchema(selfHealingActionsTable).omit({ id: true, createdAt: true, completedAt: true });
export type InsertSelfHealingAction = z.infer<typeof insertSelfHealingActionSchema>;
export type SelfHealingAction = typeof selfHealingActionsTable.$inferSelect;

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

export const insertAgentObserverRunSchema = createInsertSchema(agentObserverRunsTable).omit({ id: true, createdAt: true });
export type InsertAgentObserverRun = z.infer<typeof insertAgentObserverRunSchema>;
export type AgentObserverRun = typeof agentObserverRunsTable.$inferSelect;

export const insertVirusFamilySchema = createInsertSchema(virusFamiliesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertVirusCatalogEntrySchema = createInsertSchema(virusCatalogEntriesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertVirusFeedSourceSchema = createInsertSchema(virusFeedSourcesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertVirusIndicatorSchema = createInsertSchema(virusIndicatorsTable).omit({ id: true, createdAt: true });
export const insertVirusFeedImportSchema = createInsertSchema(virusFeedImportsTable).omit({ id: true, startedAt: true, completedAt: true });
export const insertVirusSampleSchema = createInsertSchema(virusSamplesTable).omit({ id: true, createdAt: true, verifiedAt: true });
export const insertVirusSampleAccessSchema = createInsertSchema(virusSampleAccessTable).omit({ id: true, createdAt: true });
export const insertVirusMatchSchema = createInsertSchema(virusMatchesTable).omit({ id: true, createdAt: true });
export const insertVirusScanRunSchema = createInsertSchema(virusScanRunsTable).omit({ id: true, createdAt: true, completedAt: true });
export const insertVirusDatabaseAuditSchema = createInsertSchema(virusDatabaseAuditTable).omit({ id: true, createdAt: true });

export type VirusFamily = typeof virusFamiliesTable.$inferSelect;
export type VirusCatalogEntry = typeof virusCatalogEntriesTable.$inferSelect;
export type VirusFeedSource = typeof virusFeedSourcesTable.$inferSelect;
export type VirusIndicator = typeof virusIndicatorsTable.$inferSelect;
export type VirusFeedImport = typeof virusFeedImportsTable.$inferSelect;
export type VirusSample = typeof virusSamplesTable.$inferSelect;
export type VirusSampleAccess = typeof virusSampleAccessTable.$inferSelect;
export type VirusMatch = typeof virusMatchesTable.$inferSelect;
export type VirusScanRun = typeof virusScanRunsTable.$inferSelect;
export type VirusDatabaseAudit = typeof virusDatabaseAuditTable.$inferSelect;
