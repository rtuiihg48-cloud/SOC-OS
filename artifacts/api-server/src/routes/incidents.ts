import { Router } from "express";
import { and, count, desc, eq, gte, inArray, isNull, or } from "drizzle-orm";
import {
  db,
  correlationsTable,
  sandboxQuarantinesTable,
  securityEventsTable,
} from "@workspace/db";
import { requireCapability, singleTenantScope } from "../middlewares/principal";

const router = Router();

router.get("/incidents", requireCapability("events:read", singleTenantScope), async (req, res) => {
  const tenantId = singleTenantScope(req);
  if (tenantId === null) {
    res.status(403).json({ error: "TENANT_SCOPE_MISMATCH", code: "TENANT_SCOPE_MISMATCH" });
    return;
  }

  const canReadQuarantine = req.principal!.capabilities.includes("quarantine:read");
  const openEventPredicate = and(
    eq(securityEventsTable.tenantId, tenantId),
    inArray(securityEventsTable.action, ["WARN", "ISOLATE"]),
    inArray(securityEventsTable.status, ["NEW", "ACKNOWLEDGED", "INVESTIGATING", "QUARANTINED"]),
  );
  const openCorrelationPredicate = and(
    eq(correlationsTable.tenantId, tenantId),
    isNull(correlationsTable.resolvedAt),
  );
  const openQuarantinePredicate = and(
    eq(sandboxQuarantinesTable.tenantId, tenantId),
    eq(sandboxQuarantinesTable.status, "QUARANTINED"),
  );

  const [
    events,
    correlations,
    quarantines,
    eventCountRows,
    correlationCountRows,
    quarantineCountRows,
    criticalEventCountRows,
    criticalCorrelationCountRows,
  ] = await Promise.all([
    db.select().from(securityEventsTable)
      .where(openEventPredicate)
      .orderBy(desc(securityEventsTable.timestamp))
      .limit(40),
    db.select().from(correlationsTable)
      .where(openCorrelationPredicate)
      .orderBy(desc(correlationsTable.createdAt))
      .limit(40),
    canReadQuarantine
      ? db.select().from(sandboxQuarantinesTable)
        .where(openQuarantinePredicate)
        .orderBy(desc(sandboxQuarantinesTable.createdAt))
        .limit(40)
      : Promise.resolve([]),
    db.select({ value: count() }).from(securityEventsTable).where(openEventPredicate),
    db.select({ value: count() }).from(correlationsTable).where(openCorrelationPredicate),
    canReadQuarantine
      ? db.select({ value: count() }).from(sandboxQuarantinesTable).where(openQuarantinePredicate)
      : Promise.resolve([{ value: 0 }]),
    db.select({ value: count() }).from(securityEventsTable).where(and(
      openEventPredicate,
      or(eq(securityEventsTable.action, "ISOLATE"), gte(securityEventsTable.score, 80)),
    )),
    db.select({ value: count() }).from(correlationsTable).where(and(
      openCorrelationPredicate,
      eq(correlationsTable.severity, "CRITICAL"),
    )),
  ]);

  const items = [
    ...events.map((event) => ({
        id: `event-${event.id}`,
        kind: "ALERT" as const,
        severity: event.action === "ISOLATE" || event.score >= 80 ? "CRITICAL" : "HIGH",
        status: event.status,
        title: event.action === "ISOLATE" ? "Isolation event" : "Security alert",
        summary: event.event,
        sourceId: event.id,
        createdAt: event.timestamp.toISOString(),
        targetPath: "/events",
      })),
    ...correlations.map((correlation) => ({
      id: `correlation-${correlation.id}`,
      kind: "CORRELATION" as const,
      severity: correlation.severity,
      status: correlation.resolvedAt ? "RESOLVED" : "OPEN",
      title: correlation.threatType,
      summary: correlation.summary,
      sourceId: correlation.id,
      createdAt: correlation.createdAt.toISOString(),
      targetPath: "/correlations",
    })),
    ...quarantines.map((capture) => ({
      id: `quarantine-${capture.id}`,
      kind: "QUARANTINE" as const,
      severity: "CRITICAL" as const,
      status: capture.status,
      title: "Quarantine capture",
      summary: `Execution blocked for event #${capture.eventId}`,
      sourceId: capture.id,
      createdAt: capture.createdAt.toISOString(),
      targetPath: "/quarantine",
    })),
  ]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 60);

  res.json({
    generatedAt: new Date().toISOString(),
    openIncidents:
      Number(eventCountRows[0]?.value ?? 0) +
      Number(correlationCountRows[0]?.value ?? 0) +
      Number(quarantineCountRows[0]?.value ?? 0),
    criticalIncidents:
      Number(criticalEventCountRows[0]?.value ?? 0) +
      Number(criticalCorrelationCountRows[0]?.value ?? 0) +
      Number(quarantineCountRows[0]?.value ?? 0),
    items,
  });
});

export default router;