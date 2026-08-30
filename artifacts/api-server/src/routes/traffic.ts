import crypto from "node:crypto";
import { Router } from "express";
import { db, trafficObservationsTable } from "@workspace/db";
import {
  IngestTrafficTelemetryBody,
  ListTrafficFlowsQueryParams,
} from "@workspace/api-zod";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { analyzeTraffic } from "../lib/traffic-engine";

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

function formatObservation(row: typeof trafficObservationsTable.$inferSelect) {
  return {
    ...row,
    observedAt: row.observedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function validateTelemetry(
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

async function insertObservation(
  input: ReturnType<typeof IngestTrafficTelemetryBody.parse>,
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
  const [row] = await db
    .insert(trafficObservationsTable)
    .values({
      tenantId: input.tenantId ?? null,
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

router.post("/traffic/telemetry", async (req, res) => {
  const parsed = IngestTrafficTelemetryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid gateway telemetry", issues: parsed.error.issues });
    return;
  }
  const validationError = validateTelemetry(parsed.data);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }
  try {
    const row = await insertObservation(parsed.data);
    res.status(201).json(formatObservation(row));
  } catch (error) {
    if (hasDatabaseCode(error, "23505")) {
      res.status(409).json({ error: "Observation already exists for this gateway" });
      return;
    }
    throw error;
  }
});

router.get("/traffic/flows", async (req, res) => {
  const parsed = ListTrafficFlowsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid traffic filters" });
    return;
  }
  const query = parsed.data;
  const rows = await db
    .select()
    .from(trafficObservationsTable)
    .where(and(
      query.protocol ? eq(trafficObservationsTable.protocol, query.protocol.toUpperCase()) : undefined,
      query.action ? eq(trafficObservationsTable.recommendedAction, query.action) : undefined,
      query.severity ? eq(trafficObservationsTable.severity, query.severity) : undefined,
      query.direction ? eq(trafficObservationsTable.direction, query.direction) : undefined,
      query.observationType ? eq(trafficObservationsTable.observationType, query.observationType) : undefined,
      query.gatewayId ? eq(trafficObservationsTable.gatewayId, query.gatewayId) : undefined,
    ))
    .orderBy(desc(trafficObservationsTable.observedAt))
    .limit(query.limit);
  res.json(rows.map(formatObservation));
});

router.get("/traffic/summary", async (_req, res) => {
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
    .from(trafficObservationsTable);

  const protocolRows = await db
    .select({ protocol: trafficObservationsTable.protocol, value: count() })
    .from(trafficObservationsTable)
    .where(eq(trafficObservationsTable.observationType, "FLOW"))
    .groupBy(trafficObservationsTable.protocol);
  const signalRows = await db
    .select({ signals: trafficObservationsTable.signals })
    .from(trafficObservationsTable);
  const heartbeatRows = await db
    .select()
    .from(trafficObservationsTable)
    .where(eq(trafficObservationsTable.observationType, "HEARTBEAT"))
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

router.post("/traffic/synthetic", async (_req, res) => {
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
  const rows = [];
  for (const input of inputs) {
    rows.push(await insertObservation(IngestTrafficTelemetryBody.parse(input), true));
  }
  res.status(201).json(rows.map(formatObservation));
});

export default router;