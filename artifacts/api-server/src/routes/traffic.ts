import crypto from "node:crypto";
import { Router } from "express";
import { db, securityEventsTable, trafficObservationsTable } from "@workspace/db";
import {
  IngestTrafficTelemetryBody,
  ListTrafficFlowsQueryParams,
} from "@workspace/api-zod";
import { and, count, desc, eq, gte, lte, or, sql } from "drizzle-orm";
import { analyzeTraffic } from "../lib/traffic-engine";
import { requireCapability, singleTenantScope } from "../middlewares/principal";
import { appendAudit } from "../lib/audit";

const router = Router();
const ALLOWED_PROTOCOLS = new Set([
  "TCP", "UDP", "DNS", "HTTP", "HTTPS", "TLS", "QUIC", "ICMP", "UNKNOWN",
]);

function hasDatabaseCode(error: unknown, expected: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    if ("code" in current && current.code === expected) return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

type CorrelatedEvent = {
  id: number;
  nodeId: string;
  event: string;
  score: number;
  action: string;
  status: string;
  timestamp: string;
};

function formatObservation(
  row: typeof trafficObservationsTable.$inferSelect,
  correlatedEvents: CorrelatedEvent[] = [],
) {
  return {
    ...row,
    observedAt: row.observedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    correlatedEvents,
  };
}

function canonicalTenantId(req: Parameters<typeof singleTenantScope>[0]): number {
  const tenantId = singleTenantScope(req);
  if (tenantId === null) throw new Error("Canonical tenant scope is unavailable");
  return tenantId;
}

async function correlateSocEvents(rows: Array<typeof trafficObservationsTable.$inferSelect>, tenantId: number) {
  if (rows.length === 0) return new Map<number, CorrelatedEvent[]>();
  const windows = rows.flatMap((row) =>
    [row.sourceAsset, row.destinationAsset]
      .filter((asset): asset is string => Boolean(asset))
      .map((asset) => and(
        eq(securityEventsTable.nodeId, asset),
        gte(securityEventsTable.timestamp, new Date(row.observedAt.getTime() - 5 * 60_000)),
        lte(securityEventsTable.timestamp, new Date(row.observedAt.getTime() + 5 * 60_000)),
      )),
  );
  if (windows.length === 0) return new Map<number, CorrelatedEvent[]>();
  const events = await db.select({
    id: securityEventsTable.id,
    nodeId: securityEventsTable.nodeId,
    event: securityEventsTable.event,
    score: securityEventsTable.score,
    action: securityEventsTable.action,
    status: securityEventsTable.status,
    timestamp: securityEventsTable.timestamp,
  }).from(securityEventsTable).where(and(
    eq(securityEventsTable.tenantId, tenantId),
    or(...windows),
  )).orderBy(desc(securityEventsTable.timestamp));
  const result = new Map<number, CorrelatedEvent[]>();
  for (const row of rows) {
    const matches = events
      .filter((event) =>
        (event.nodeId === row.sourceAsset || event.nodeId === row.destinationAsset) &&
        Math.abs(event.timestamp.getTime() - row.observedAt.getTime()) <= 5 * 60_000)
      .map((event) => ({ ...event, timestamp: event.timestamp.toISOString() }));
    if (matches.length > 0) result.set(row.id, matches);
  }
  return result;
}

export function validateTelemetry(
  input: ReturnType<typeof IngestTrafficTelemetryBody.parse>,
): string | null {
  const now = Date.now();
  const observedAt = input.observedAt.getTime();
  if (observedAt > now + 5 * 60_000) return "observedAt is too far in the future";
  if (observedAt < now - 30 * 24 * 60 * 60_000) return "observedAt is older than the 30-day ingestion window";
  if (input.observationType === "HEARTBEAT" && !input.heartbeatStatus) {
    return "HEARTBEAT observations require heartbeatStatus";
  }
  if (
    input.observationType === "FLOW" &&
    (!input.sourceAsset || !input.destinationAsset)
  ) {
    return "FLOW observations require sourceAsset and destinationAsset";
  }
  if (!ALLOWED_PROTOCOLS.has(input.protocol.toUpperCase())) {
    return "Unsupported traffic protocol";
  }
  return null;
}

export function gatewayScopeAllows(principal: NonNullable<Express.Request["principal"]>, gatewayId: string): boolean {
  if (principal.principalType !== "GATEWAY") return true;
  return typeof principal.gatewayScope === "string" && principal.gatewayScope === gatewayId;
}

async function insertObservation(
  input: ReturnType<typeof IngestTrafficTelemetryBody.parse>,
  tenantId: number,
  executor: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0] = db,
  isSynthetic = false,
) {
  const protocol = input.protocol.toUpperCase();
  const analysis = analyzeTraffic({
    observationType: input.observationType,
    protocol,
    direction: input.direction,
    bytesOut: input.bytesOut,
    bytesIn: input.bytesIn,
    packets: input.packets,
    durationMs: input.durationMs,
    dnsQueryName: input.dnsQueryName,
    heartbeatStatus: input.heartbeatStatus,
    heartbeatLatencyMs: input.heartbeatLatencyMs,
  });
  const [row] = await executor
    .insert(trafficObservationsTable)
    .values({
      // Telemetry's declared tenant is untrusted; credential/session scope is authoritative.
      tenantId,
      gatewayId: input.gatewayId,
      observationId: input.observationId,
      observationType: input.observationType,
      observedAt: input.observedAt,
      protocol,
      direction: input.direction,
      sourceAsset: input.sourceAsset ?? null,
      destinationAsset: input.destinationAsset ?? null,
      sourcePort: input.sourcePort ?? null,
      destinationPort: input.destinationPort ?? null,
      bytesOut: input.bytesOut,
      bytesIn: input.bytesIn,
      packets: input.packets,
      durationMs: input.durationMs,
      dnsQueryName: input.dnsQueryName ?? null,
      tlsServerName: input.tlsServerName ?? null,
      httpHost: input.httpHost ?? null,
      heartbeatStatus: input.heartbeatStatus ?? null,
      heartbeatLatencyMs: input.heartbeatLatencyMs ?? null,
      isSynthetic,
      ...analysis,
    })
    .returning();
  return row;
}

router.post("/traffic/telemetry", requireCapability("events:ingest", singleTenantScope), async (req, res) => {
  const parsed = IngestTrafficTelemetryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid gateway telemetry", issues: parsed.error.issues });
    return;
  }
  if (!gatewayScopeAllows(req.principal!, parsed.data.gatewayId)) {
    res.status(403).json({ error: "GATEWAY_SCOPE_MISMATCH", code: "GATEWAY_SCOPE_MISMATCH" });
    return;
  }
  const validationError = validateTelemetry(parsed.data);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }
  try {
    const tenantId = canonicalTenantId(req);
    const row = await db.transaction(async (tx) => {
      const created = await insertObservation(parsed.data, tenantId, tx);
      await appendAudit(tx, {
        tenantId, principal: req.principal!, action: "traffic:telemetry:ingest",
        targetType: "traffic_observation", targetId: String(created.id),
        decision: "COMMITTED", reasonCode: "TRAFFIC_TELEMETRY_RECORDED",
        correlationId: req.principal!.correlationId,
        metadata: { gatewayId: created.gatewayId, observationType: created.observationType, isSynthetic: false },
      });
      return created;
    });
    res.status(201).json(formatObservation(row));
  } catch (error) {
    if (hasDatabaseCode(error, "23505")) {
      res.status(409).json({ error: "Observation already exists for this gateway" });
      return;
    }
    throw error;
  }
});

router.get("/traffic/flows", requireCapability("traffic:read", singleTenantScope), async (req, res) => {
  const parsed = ListTrafficFlowsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid traffic filters" });
    return;
  }
  const query = parsed.data;
  const tenantId = canonicalTenantId(req);
  const rows = await db
    .select()
    .from(trafficObservationsTable)
    .where(and(
      eq(trafficObservationsTable.tenantId, tenantId),
      eq(trafficObservationsTable.isSynthetic, false),
      query.protocol ? eq(trafficObservationsTable.protocol, query.protocol.toUpperCase()) : undefined,
      query.action ? eq(trafficObservationsTable.recommendedAction, query.action) : undefined,
      query.severity ? eq(trafficObservationsTable.severity, query.severity) : undefined,
      query.direction ? eq(trafficObservationsTable.direction, query.direction) : undefined,
      query.observationType ? eq(trafficObservationsTable.observationType, query.observationType) : undefined,
      query.gatewayId ? eq(trafficObservationsTable.gatewayId, query.gatewayId) : undefined,
    ))
    .orderBy(desc(trafficObservationsTable.observedAt))
    .limit(query.limit);
  const correlations = await correlateSocEvents(rows, tenantId);
  res.json(rows.map((row) => formatObservation(row, correlations.get(row.id) ?? [])));
});

router.get("/traffic/summary", requireCapability("traffic:read", singleTenantScope), async (req, res) => {
  const tenantId = canonicalTenantId(req);
  const [totals] = await db
    .select({
      totalObservations: count(),
      flowCount: count(sql`CASE WHEN ${trafficObservationsTable.observationType} = 'FLOW' THEN 1 END`),
      heartbeatCount: count(sql`CASE WHEN ${trafficObservationsTable.observationType} = 'HEARTBEAT' THEN 1 END`),
      highRiskCount: count(sql`CASE WHEN ${trafficObservationsTable.riskScore} >= 50 THEN 1 END`),
      isolatedCount: count(sql`CASE WHEN ${trafficObservationsTable.recommendedAction} = 'ISOLATE' THEN 1 END`),
      warnedCount: count(sql`CASE WHEN ${trafficObservationsTable.recommendedAction} = 'WARN' THEN 1 END`),
      bytesOut: sql<number>`coalesce(sum(${trafficObservationsTable.bytesOut}), 0)`,
      bytesIn: sql<number>`coalesce(sum(${trafficObservationsTable.bytesIn}), 0)`,
    })
    .from(trafficObservationsTable)
    .where(and(eq(trafficObservationsTable.tenantId, tenantId), eq(trafficObservationsTable.isSynthetic, false)));

  const protocolRows = await db
    .select({ protocol: trafficObservationsTable.protocol, value: count() })
    .from(trafficObservationsTable)
    .where(and(eq(trafficObservationsTable.tenantId, tenantId), eq(trafficObservationsTable.observationType, "FLOW"), eq(trafficObservationsTable.isSynthetic, false)))
    .groupBy(trafficObservationsTable.protocol);
  const signalRows = await db
    .select({ signals: trafficObservationsTable.signals })
    .from(trafficObservationsTable)
    .where(and(eq(trafficObservationsTable.tenantId, tenantId), eq(trafficObservationsTable.isSynthetic, false)));
  const heartbeatRows = await db
    .select()
    .from(trafficObservationsTable)
    .where(and(eq(trafficObservationsTable.tenantId, tenantId), eq(trafficObservationsTable.observationType, "HEARTBEAT"), eq(trafficObservationsTable.isSynthetic, false)))
    .orderBy(desc(trafficObservationsTable.observedAt));

  const signalBreakdown: Record<string, number> = {};
  for (const row of signalRows) {
    for (const signal of row.signals) {
      signalBreakdown[signal] = (signalBreakdown[signal] ?? 0) + 1;
    }
  }
  const latestHeartbeatByGateway = new Map<string, typeof heartbeatRows[number]>();
  for (const row of heartbeatRows) {
    if (!latestHeartbeatByGateway.has(row.gatewayId)) latestHeartbeatByGateway.set(row.gatewayId, row);
  }
  const latestHeartbeats = [...latestHeartbeatByGateway.values()];
  const lastSeen = heartbeatRows[0]?.observedAt ?? null;

  res.json({
    totalObservations: Number(totals.totalObservations),
    flowCount: Number(totals.flowCount),
    heartbeatCount: Number(totals.heartbeatCount),
    highRiskCount: Number(totals.highRiskCount),
    isolatedCount: Number(totals.isolatedCount),
    warnedCount: Number(totals.warnedCount),
    bytesOut: Number(totals.bytesOut),
    bytesIn: Number(totals.bytesIn),
    protocolBreakdown: Object.fromEntries(protocolRows.map((row) => [row.protocol, Number(row.value)])),
    signalBreakdown,
    gatewayHealth: {
      total: latestHeartbeats.length,
      healthy: latestHeartbeats.filter((row) => row.heartbeatStatus === "HEALTHY").length,
      degraded: latestHeartbeats.filter((row) => row.heartbeatStatus === "DEGRADED").length,
      offline: latestHeartbeats.filter((row) => row.heartbeatStatus === "OFFLINE").length,
      lastSeenAt: lastSeen?.toISOString() ?? null,
    },
    generatedAt: new Date().toISOString(),
  });
});

router.post("/traffic/synthetic", requireCapability("events:ingest", singleTenantScope), async (req, res) => {
  const runId = crypto.randomUUID();
  const observedAt = new Date();
  const inputs = [
    {
      gatewayId: "synthetic-gateway",
      observationId: `${runId}:beacon`,
      observationType: "FLOW" as const,
      observedAt,
      protocol: "TLS",
      direction: "OUTBOUND" as const,
      sourceAsset: "lab-endpoint-01",
      destinationAsset: "synthetic-c2.invalid",
      destinationPort: 443,
      bytesOut: 24_000,
      bytesIn: 8_000,
      packets: 24,
      durationMs: 900_000,
    },
    {
      gatewayId: "synthetic-gateway",
      observationId: `${runId}:scan`,
      observationType: "FLOW" as const,
      observedAt,
      protocol: "TCP",
      direction: "OUTBOUND" as const,
      sourceAsset: "lab-endpoint-02",
      destinationAsset: "synthetic-subnet.invalid",
      destinationPort: 0,
      bytesOut: 32_000,
      bytesIn: 0,
      packets: 400,
      durationMs: 20_000,
    },
    {
      gatewayId: "synthetic-gateway",
      observationId: `${runId}:dns`,
      observationType: "FLOW" as const,
      observedAt,
      protocol: "DNS",
      direction: "OUTBOUND" as const,
      sourceAsset: "lab-endpoint-03",
      destinationAsset: "synthetic-resolver.invalid",
      destinationPort: 53,
      bytesOut: 12_000,
      bytesIn: 7_000,
      packets: 40,
      durationMs: 10_000,
      dnsQueryName: `${"a".repeat(52)}.${"b".repeat(28)}.invalid`,
    },
    {
      gatewayId: "synthetic-gateway",
      observationId: `${runId}:exfil`,
      observationType: "FLOW" as const,
      observedAt,
      protocol: "HTTPS",
      direction: "OUTBOUND" as const,
      sourceAsset: "lab-endpoint-04",
      destinationAsset: "synthetic-storage.invalid",
      destinationPort: 443,
      bytesOut: 120_000_000,
      bytesIn: 2_000_000,
      packets: 15_000,
      durationMs: 180_000,
      tlsServerName: "synthetic-storage.invalid",
    },
  ];
  const tenantId = canonicalTenantId(req);
  const now = new Date();
  const rows = inputs.map((raw, index) => {
    const input = IngestTrafficTelemetryBody.parse(raw);
    return {
      id: -(index + 1),
      tenantId,
      gatewayId: input.gatewayId,
      observationId: input.observationId,
      observationType: input.observationType,
      observedAt: input.observedAt,
      protocol: input.protocol.toUpperCase(),
      direction: input.direction,
      sourceAsset: input.sourceAsset ?? null,
      destinationAsset: input.destinationAsset ?? null,
      sourcePort: input.sourcePort ?? null,
      destinationPort: input.destinationPort ?? null,
      bytesOut: input.bytesOut,
      bytesIn: input.bytesIn,
      packets: input.packets,
      durationMs: input.durationMs,
      dnsQueryName: input.dnsQueryName ?? null,
      tlsServerName: input.tlsServerName ?? null,
      httpHost: input.httpHost ?? null,
      heartbeatStatus: input.heartbeatStatus ?? null,
      heartbeatLatencyMs: input.heartbeatLatencyMs ?? null,
      isSynthetic: true,
      ...analyzeTraffic(input),
      createdAt: now,
    };
  });
  await db.transaction(async (tx) => {
    await appendAudit(tx, {
      tenantId, principal: req.principal!, action: "traffic:synthetic:preview",
      targetType: "traffic_synthetic_run", targetId: runId, decision: "COMMITTED",
      reasonCode: "SYNTHETIC_TRAFFIC_PREVIEWED", correlationId: req.principal!.correlationId,
      metadata: { observationCount: rows.length, persistedToLiveTraffic: false },
    });
  });
  res.status(200).json(rows.map((row) => formatObservation(row)));
});

export default router;