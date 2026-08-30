import { Router } from "express";
import { db, securityEventsTable, patchesTable, correlationsTable, sandboxQuarantinesTable } from "@workspace/db";
import { desc, eq, and } from "drizzle-orm";
import {
  buildEventResult,
  autoFix,
  runSelfRedTeam,
  computeNodeId,
  computeHash,
} from "../lib/soc-engine";
import { applyRules } from "../lib/rules-engine";
import { correlate } from "../lib/correlation-engine";
import { enqueue, queueStats } from "../lib/queue";
import { broadcast } from "../lib/websocket";
import { buildQuarantineCapture } from "../lib/quarantine-shell";
import {
  automaticallyRestoreManagedResource,
  managedStateSize,
  SELF_HEALING_POLICY,
} from "../lib/self-healing";
import {
  ProcessEventBody,
  UpdateEventStatusBody,
  ListEventsQueryParams,
} from "@workspace/api-zod";
import { requireCapability, singleTenantScope } from "../middlewares/principal";
import { appendAudit } from "../lib/audit";

const router = Router();

// ─── List Events ─────────────────────────────────────────────────────────────
router.get("/events", requireCapability("events:read", singleTenantScope), async (req, res) => {
  const parsed = ListEventsQueryParams.safeParse(req.query);
  const filters = parsed.success ? parsed.data : {};

  const tenantId = singleTenantScope(req);
  if (tenantId === null) { res.status(403).json({ error: "TENANT_SCOPE_MISMATCH", code: "TENANT_SCOPE_MISMATCH" }); return; }
  if (filters.tenantId && Number(filters.tenantId) !== tenantId) { res.status(403).json({ error: "TENANT_SCOPE_MISMATCH", code: "TENANT_SCOPE_MISMATCH" }); return; }
  const events = await db
    .select()
    .from(securityEventsTable)
    .where(eq(securityEventsTable.tenantId, tenantId))
    .orderBy(desc(securityEventsTable.timestamp))
    .limit(filters.limit ?? 200);

  const filtered = events
    .filter((e) => !filters.action || e.action === filters.action)
    .filter((e) => !filters.status || e.status === filters.status)
    .filter((e) => !filters.tactic || e.tactic === filters.tactic)
    .filter((e) => e.tenantId === tenantId);

  res.json(filtered.map(formatEvent));
});

// ─── V30/V50 Full SOC Pipeline ────────────────────────────────────────────────
// Stages: Ingest → Rules Engine → Risk Engine → Correlation → Decision → Save → Broadcast
router.post("/events", requireCapability("events:ingest", singleTenantScope), async (req, res) => {
  const parsed = ProcessEventBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const {
    event,
    cpuUsage,
    memUsage,
    managedResourceKey,
    observedManagedState,
  } = parsed.data;
  const tenantId = singleTenantScope(req);
  if (tenantId === null || ("tenantId" in req.body && Number(req.body.tenantId) !== tenantId)) {
    res.status(403).json({ error: "TENANT_SCOPE_MISMATCH", code: "TENANT_SCOPE_MISMATCH" });
    return;
  }
  if (
    observedManagedState &&
    managedStateSize(observedManagedState) > SELF_HEALING_POLICY.maxStateBytes
  ) {
    res.status(400).json({ error: "Observed managed state exceeds the 64 KB policy limit" });
    return;
  }

  const pipelineStages: string[] = [];

  // ── Stage 1: Ingest ──────────────────────────────────────────────────────
  pipelineStages.push("INGEST");

  // ── Stage 2: Base Risk Engine (MITRE + Regex + Velocity) ─────────────────
  pipelineStages.push("RISK_ENGINE");
  const last = await db
    .select({ hash: securityEventsTable.hash })
    .from(securityEventsTable)
    .orderBy(desc(securityEventsTable.timestamp))
    .limit(1);

  const prevHash = last[0]?.hash ?? "GENESIS";
  let result = buildEventResult(event, prevHash, cpuUsage ?? 0, memUsage ?? 0);

  // ── Stage 3: Rules Engine (DB-stored rules — V30 core feature) ───────────
  pipelineStages.push("RULES_ENGINE");
  const rulesResult = await applyRules(event, tenantId);

  let finalScore = result.score + rulesResult.totalBoost;
  let finalAction = rulesResult.forcedAction ?? result.action;

  // Re-determine action from boosted score if no forced action
  if (!rulesResult.forcedAction) {
    if (finalScore >= 15) finalAction = "ISOLATE";
    else if (finalScore >= 7) finalAction = "WARN";
    else finalAction = "ALLOW";
  }

  // ── Stage 4: Correlation Engine (attack chain detection — V50 core value) ─
  pipelineStages.push("CORRELATION_ENGINE");
  const recentEvents = await db
    .select({ event: securityEventsTable.event })
    .from(securityEventsTable)
    .orderBy(desc(securityEventsTable.timestamp))
    .limit(20);
  const recentTexts = [...recentEvents.map((e) => e.event), event];
  const correlationResult = correlate(recentTexts);

  // ── Stage 5: Decision Engine ─────────────────────────────────────────────
  pipelineStages.push("DECISION_ENGINE");

  // ── Stage 6: SOAR Auto-Fix ───────────────────────────────────────────────
  pipelineStages.push("SOAR");
  const fix = finalAction !== "ALLOW" ? autoFix(event) : null;

  // ── Stage 7: Persist to DB ───────────────────────────────────────────────
  pipelineStages.push("PERSIST");
  const persisted = await db.transaction(async (tx) => {
    let correlationId: number | null = null;
    if (correlationResult) {
      const [savedCorr] = await tx.insert(correlationsTable).values({
        tenantId,
        threatType: correlationResult.threatType,
        severity: correlationResult.severity,
        confidence: correlationResult.confidence,
        summary: correlationResult.summary,
        eventIds: JSON.stringify([]),
      }).returning();
      correlationId = savedCorr.id;
    }
    const [eventRow] = await tx
      .insert(securityEventsTable)
      .values({
        tenantId,
        event: result.event,
        score: finalScore,
        action: finalAction,
        status: "NEW",
        tactic: result.tactic,
        technique: result.technique,
        techniqueId: result.techniqueId,
        velocityFlag: result.velocityFlag,
        severity: result.severity,
        ruleMatches: result.matches.length > 0 ? JSON.stringify(result.matches) : null,
        correlationId,
        nodeId: result.nodeId,
        hash: result.hash,
        prevHash: result.prevHash,
        cpuUsage: cpuUsage ?? null,
        memUsage: memUsage ?? null,
      })
      .returning();
    if (fix) await tx.insert(patchesTable).values({ tenantId, attack: event, fix, tactic: result.tactic });

    if (finalAction !== "ISOLATE") {
      await appendAudit(tx, {
        tenantId, principal: req.principal!, action: "events:ingest", targetType: "security_event",
        targetId: String(eventRow.id), decision: "COMMITTED", reasonCode: "EVENT_PERSISTED",
        correlationId: req.principal!.correlationId, metadata: { action: finalAction, severity: result.severity, correlationId },
      });
      return { event: eventRow, quarantine: null, correlationId };
    }

    const capture = buildQuarantineCapture({
      eventId: eventRow.id,
      tenantId,
      event: eventRow.event,
      score: eventRow.score,
      action: eventRow.action,
      status: "QUARANTINED",
      severity: eventRow.severity,
      tactic: eventRow.tactic,
      technique: eventRow.technique,
      techniqueId: eventRow.techniqueId,
      velocityFlag: eventRow.velocityFlag,
      ruleMatches: eventRow.ruleMatches,
      hash: eventRow.hash,
      prevHash: eventRow.prevHash,
      nodeId: eventRow.nodeId,
    });

    const [quarantine] = await tx
      .insert(sandboxQuarantinesTable)
      .values({
        eventId: eventRow.id,
        tenantId,
        isolationId: capture.isolationId,
        status: capture.status,
        shellType: capture.shellType,
        reason: capture.reason,
        snapshot: capture.snapshot,
        executionAllowed: capture.executionAllowed,
      })
      .returning();

    const [quarantinedEvent] = await tx
      .update(securityEventsTable)
      .set({ status: "QUARANTINED" })
      .where(eq(securityEventsTable.id, eventRow.id))
      .returning();

    const committedEvent = quarantinedEvent ?? eventRow;
    await appendAudit(tx, {
      tenantId, principal: req.principal!, action: "events:ingest", targetType: "security_event",
      targetId: String(committedEvent.id), decision: "COMMITTED", reasonCode: "EVENT_PERSISTED",
      correlationId: req.principal!.correlationId, metadata: { action: finalAction, severity: result.severity, correlationId, quarantineId: quarantine.id },
    });
    return { event: committedEvent, quarantine, correlationId };
  });

  const inserted = persisted.event;
  const correlationId = persisted.correlationId;

  const formatted = formatEvent(inserted);

  // ── Stage 8: Verified Self-Healing ────────────────────────────────────────
  // Recovery never suppresses or rolls back the event/quarantine evidence.
  let selfHealing = null;
  if (finalAction === "ISOLATE" && managedResourceKey) {
    pipelineStages.push("SELF_HEALING");
    const recovery = await automaticallyRestoreManagedResource({
      resourceKey: managedResourceKey,
      tenantId,
      eventId: inserted.id,
      observedState: observedManagedState,
    });
    if (recovery) {
      selfHealing = {
        ...recovery.action,
        createdAt: recovery.action.createdAt.toISOString(),
        completedAt: recovery.action.completedAt?.toISOString() ?? null,
      };
    }
  }

  // ── Stage 9: Broadcast (WebSocket + SSE) ─────────────────────────────────
  pipelineStages.push("BROADCAST");
  const broadcastPayload = {
    type: "security_event",
    event: formatted,
    correlation: correlationResult ?? null,
    rulesMatched: rulesResult.matches.length,
    scoreBoost: rulesResult.totalBoost,
  };

  // Side effects occur only after the transaction containing both evidence and
  // protected records has committed.
  enqueue({ event, tenantId, cpuUsage: cpuUsage ?? undefined, memUsage: memUsage ?? undefined, enqueuedAt: Date.now(), source: "api" });
  broadcast(broadcastPayload, tenantId ?? undefined);
  sseClients.forEach((client) => {
    if (client.tenantId === tenantId) client.send(formatted);
  });

  res.json({
    event: formatted,
    rulesMatched: rulesResult.matches.length,
    scoreBoost: rulesResult.totalBoost,
    correlation: correlationResult
      ? {
          id: correlationId,
          tenantId,
          threatType: correlationResult.threatType,
          severity: correlationResult.severity,
          confidence: correlationResult.confidence,
          summary: correlationResult.summary,
          eventIds: "[]",
          resolvedAt: null,
          createdAt: new Date().toISOString(),
        }
      : null,
    quarantine: persisted.quarantine
      ? {
          id: persisted.quarantine.id,
          isolationId: persisted.quarantine.isolationId,
          status: persisted.quarantine.status,
          shellType: persisted.quarantine.shellType,
          executionAllowed: persisted.quarantine.executionAllowed,
        }
      : null,
    selfHealing,
    pipelineStages,
  });
});

// ─── SSE Stream ───────────────────────────────────────────────────────────────
// MUST be registered before /events/:id — "stream" would be parsed as NaN id
type SseSend = (data: unknown) => void;
type SseClient = { tenantId: number; send: SseSend };
export const sseClients = new Set<SseClient>();

router.get("/events/stream", requireCapability("events:read", singleTenantScope), (req, res) => {
  const tenantId = singleTenantScope(req);
  if (tenantId === null) {
    res.status(403).json({ error: "TENANT_SCOPE_MISMATCH", code: "TENANT_SCOPE_MISMATCH" });
    return;
  }
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send: SseSend = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const client = { tenantId, send };
  sseClients.add(client);
  res.write(": connected\n\n");

  req.on("close", () => {
    sseClients.delete(client);
  });
});

// ─── Get Single Event ─────────────────────────────────────────────────────────
router.get("/events/:id", requireCapability("events:read", singleTenantScope), async (req, res) => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const tenantId = singleTenantScope(req);
  if (tenantId === null) {
    res.status(403).json({ error: "TENANT_SCOPE_MISMATCH", code: "TENANT_SCOPE_MISMATCH" });
    return;
  }
  const [event] = await db.select().from(securityEventsTable).where(and(eq(securityEventsTable.id, id), eq(securityEventsTable.tenantId, tenantId)));
  if (!event) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatEvent(event));
});

// ─── Update Alert Status ──────────────────────────────────────────────────────
router.patch("/events/:id/status", requireCapability("events:status:update", singleTenantScope), async (req, res) => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = UpdateEventStatusBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid status" }); return; }

  const tenantId = singleTenantScope(req);
  if (tenantId === null) { res.status(403).json({ error: "TENANT_SCOPE_MISMATCH", code: "TENANT_SCOPE_MISMATCH" }); return; }
  const [updated] = await db.transaction(async (tx) => {
    const [row] = await tx.update(securityEventsTable).set({ status: parsed.data.status }).where(and(eq(securityEventsTable.id, id), eq(securityEventsTable.tenantId, tenantId))).returning();
    if (row) await appendAudit(tx, { tenantId, principal: req.principal!, action: "events:status:update", targetType: "security_event", targetId: String(id), decision: "COMMITTED", reasonCode: "STATUS_UPDATED", correlationId: req.principal!.correlationId, metadata: { status: parsed.data.status } });
    return [row];
  });

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  // Broadcast status change via WebSocket
  broadcast({ type: "status_update", eventId: id, status: parsed.data.status }, tenantId);
  res.json(formatEvent(updated));
});

// ─── Queue Stats ──────────────────────────────────────────────────────────────
router.get("/queue-stats", requireCapability("events:read", singleTenantScope), (req, res) => {
  const tenantId = singleTenantScope(req);
  if (tenantId === null) {
    res.status(403).json({ error: "TENANT_SCOPE_MISMATCH", code: "TENANT_SCOPE_MISMATCH" });
    return;
  }
  res.json(queueStats(tenantId));
});

// ─── Self Red-Team ────────────────────────────────────────────────────────────
router.post("/self-test", requireCapability("testing:run", singleTenantScope), async (req, res) => {
  const tenantId = singleTenantScope(req);
  if (tenantId === null) {
    res.status(403).json({ error: "TENANT_SCOPE_MISMATCH", code: "TENANT_SCOPE_MISMATCH" });
    return;
  }
  const last = await db
    .select({ hash: securityEventsTable.hash })
    .from(securityEventsTable)
    .where(eq(securityEventsTable.tenantId, tenantId))
    .orderBy(desc(securityEventsTable.timestamp))
    .limit(1);

  const prevHash = last[0]?.hash ?? "GENESIS";
  const redTeamResults = runSelfRedTeam(prevHash);

  const vulnerabilities: Array<{ attack: string; score: number; action: string; tactic: string | null; technique: string | null; fix: string | null }> = [];
  let patchesApplied = 0;

  await db.transaction(async (tx) => {
  for (const { result, fix } of redTeamResults) {
    await tx.insert(securityEventsTable).values({
      tenantId,
      event: result.event,
      score: result.score,
      action: result.action,
      status: "NEW",
      severity: result.severity,
      ruleMatches: result.matches.length > 0 ? JSON.stringify(result.matches) : null,
      tactic: result.tactic,
      technique: result.technique,
      techniqueId: result.techniqueId,
      velocityFlag: result.velocityFlag,
      nodeId: result.nodeId,
      hash: result.hash,
      prevHash: result.prevHash,
    });

    if (fix) {
      const fixHash = computeHash(`SELF_FIX: ${fix}`, 0, "PATCHED", result.hash, Date.now());
      await tx.insert(securityEventsTable).values({
        tenantId,
        event: `SELF_FIX: ${fix}`,
        score: 0,
        action: "PATCHED",
        status: "RESOLVED",
        severity: "LOW",
        tactic: result.tactic,
        technique: result.technique,
        techniqueId: result.techniqueId,
        velocityFlag: false,
        nodeId: computeNodeId(`SELF_FIX: ${fix}`),
        hash: fixHash,
        prevHash: result.hash,
      });

      await tx.insert(patchesTable).values({ tenantId, attack: result.event, fix, tactic: result.tactic });
      patchesApplied++;
    }

    vulnerabilities.push({
      attack: result.event,
      score: result.score,
      action: result.action,
      tactic: result.tactic,
      technique: result.technique,
      fix: fix ?? null,
    });
  }
  await appendAudit(tx, { tenantId, principal: req.principal!, action: "testing:self-test", targetType: "self_test_run", targetId: req.principal!.correlationId, decision: "COMMITTED", reasonCode: "SELF_TEST_RECORDED", correlationId: req.principal!.correlationId, metadata: { generatedEvents: redTeamResults.length, patchesApplied } });
  });

  const maxScore = Math.max(...vulnerabilities.map((v) => v.score), 0);
  const systemStatus = maxScore >= 15 ? "CRITICAL" : maxScore >= 7 ? "ALERT" : "MONITORING";

  res.json({ vulnerabilities, patchesApplied, systemStatus });
});

// ─── Full Simulation ──────────────────────────────────────────────────────────
router.post("/simulate", requireCapability("testing:run", singleTenantScope), async (req, res) => {
  const tenantId = singleTenantScope(req);
  if (tenantId === null) {
    res.status(403).json({ error: "TENANT_SCOPE_MISMATCH", code: "TENANT_SCOPE_MISMATCH" });
    return;
  }
  const last = await db
    .select({ hash: securityEventsTable.hash })
    .from(securityEventsTable)
    .where(eq(securityEventsTable.tenantId, tenantId))
    .orderBy(desc(securityEventsTable.timestamp))
    .limit(1);

  const prevHash = last[0]?.hash ?? "GENESIS";
  const baseResult = buildEventResult("user login scan attempt", prevHash, 45, 60);

  const simulation = await db.transaction(async (tx) => {
  const [baseEvent] = await tx.insert(securityEventsTable)
    .values({
      tenantId,
      event: baseResult.event,
      score: baseResult.score,
      action: baseResult.action,
      status: "NEW",
      severity: baseResult.severity,
      ruleMatches: baseResult.matches.length > 0 ? JSON.stringify(baseResult.matches) : null,
      tactic: baseResult.tactic,
      technique: baseResult.technique,
      techniqueId: baseResult.techniqueId,
      velocityFlag: baseResult.velocityFlag,
      nodeId: baseResult.nodeId,
      hash: baseResult.hash,
      prevHash: baseResult.prevHash,
      cpuUsage: 45,
      memUsage: 60,
    })
    .returning();

  const redTeamResults = runSelfRedTeam(baseResult.hash);
  const selfHealingEvents: Array<{ attack: string; tactic: string | null; fix: string }> = [];
  let patchesApplied = 0;

  for (const { result, fix } of redTeamResults) {
    await tx.insert(securityEventsTable).values({
      tenantId,
      event: result.event,
      score: result.score,
      action: result.action,
      status: "NEW",
      severity: result.severity,
      ruleMatches: result.matches.length > 0 ? JSON.stringify(result.matches) : null,
      tactic: result.tactic,
      technique: result.technique,
      techniqueId: result.techniqueId,
      velocityFlag: result.velocityFlag,
      nodeId: result.nodeId,
      hash: result.hash,
      prevHash: result.prevHash,
    });

    if (fix) {
      await tx.insert(patchesTable).values({ tenantId, attack: result.event, fix, tactic: result.tactic });
      selfHealingEvents.push({ attack: result.event, tactic: result.tactic, fix });
      patchesApplied++;
    }
  }
  await appendAudit(tx, { tenantId, principal: req.principal!, action: "testing:simulate", targetType: "simulation_run", targetId: req.principal!.correlationId, decision: "COMMITTED", reasonCode: "SIMULATION_RECORDED", correlationId: req.principal!.correlationId, metadata: { totalProcessed: redTeamResults.length + 1, patchesApplied } });
  return { baseEvent, selfHealingEvents, patchesApplied, totalProcessed: redTeamResults.length + 1 };
  });

  res.json({
    baseEvent: formatEvent(simulation.baseEvent),
    selfHealingEvents: simulation.selfHealingEvents,
    totalProcessed: simulation.totalProcessed,
    patchesApplied: simulation.patchesApplied,
  });
});

// ─── Helper ───────────────────────────────────────────────────────────────────
function formatEvent(e: typeof securityEventsTable.$inferSelect) {
  return {
    ...e,
    timestamp: e.timestamp.toISOString(),
  };
}

export default router;
