import { Router } from "express";
import { db, securityEventsTable, patchesTable, correlationsTable } from "@workspace/db";
import { desc, sql, count } from "drizzle-orm";
import { getSystemMetrics } from "../lib/system-metrics";

const router = Router();

// ─── Patches ──────────────────────────────────────────────────────────────────
router.get("/patches", async (req, res) => {
  const patches = await db
    .select()
    .from(patchesTable)
    .orderBy(desc(patchesTable.appliedAt));
  res.json(patches.map((p) => ({ ...p, appliedAt: p.appliedAt.toISOString() })));
});

// ─── Dashboard Summary ────────────────────────────────────────────────────────
// Aggregated metrics computed in a single pass — this is what turns raw events
// into actionable SOC intelligence for the operator's first glance.
router.get("/dashboard", async (req, res) => {
  const [totalEventsRow] = await db.select({ count: count() }).from(securityEventsTable);
  const [totalPatchesRow] = await db.select({ count: count() }).from(patchesTable);
  const [totalCorrelationsRow] = await db.select({ count: count() }).from(correlationsTable);

  const actionRows = await db
    .select({ action: securityEventsTable.action, count: count() })
    .from(securityEventsTable)
    .groupBy(securityEventsTable.action);

  const statusRows = await db
    .select({ status: securityEventsTable.status, count: count() })
    .from(securityEventsTable)
    .groupBy(securityEventsTable.status);

  const tacticRows = await db
    .select({ tactic: securityEventsTable.tactic, count: count() })
    .from(securityEventsTable)
    .groupBy(securityEventsTable.tactic)
    .orderBy(desc(count()));

  const [avgRow] = await db
    .select({ avg: sql<number>`ROUND(AVG(score)::numeric, 1)` })
    .from(securityEventsTable);

  const recentEvents = await db
    .select()
    .from(securityEventsTable)
    .orderBy(desc(securityEventsTable.timestamp))
    .limit(10);

  const actionCounts = { ALLOW: 0, WARN: 0, ISOLATE: 0, PATCHED: 0 };
  for (const r of actionRows) {
    const k = r.action as keyof typeof actionCounts;
    if (k in actionCounts) actionCounts[k] = Number(r.count);
  }

  const statusCounts = { NEW: 0, ACKNOWLEDGED: 0, INVESTIGATING: 0, RESOLVED: 0 };
  for (const r of statusRows) {
    const k = r.status as keyof typeof statusCounts;
    if (k in statusCounts) statusCounts[k] = Number(r.count);
  }

  const topTactics = tacticRows
    .filter((r) => r.tactic !== null)
    .slice(0, 6)
    .map((r) => ({ tactic: r.tactic as string, count: Number(r.count) }));

  const totalEvents = Number(totalEventsRow?.count ?? 0);
  const totalPatches = Number(totalPatchesRow?.count ?? 0);
  const totalCorrelations = Number(totalCorrelationsRow?.count ?? 0);
  const avgScore = Number(avgRow?.avg ?? 0);
  const threatLevel = Math.min(100, Math.round(avgScore * 5));
  const openAlerts = statusCounts.NEW + statusCounts.ACKNOWLEDGED + statusCounts.INVESTIGATING;
  const resolvedAlerts = statusCounts.RESOLVED;

  let systemStatus: "SECURE" | "MONITORING" | "ALERT" | "CRITICAL" = "SECURE";
  if (actionCounts.ISOLATE > 0) systemStatus = "CRITICAL";
  else if (actionCounts.WARN > 2) systemStatus = "ALERT";
  else if (totalEvents > 0) systemStatus = "MONITORING";

  res.json({
    totalEvents,
    totalPatches,
    totalCorrelations,
    openAlerts,
    resolvedAlerts,
    actionCounts,
    statusCounts,
    systemStatus,
    avgRiskScore: avgScore,
    recentEvents: recentEvents.map((e) => ({ ...e, timestamp: e.timestamp.toISOString() })),
    threatLevel,
    topTactics,
  });
});

// ─── Threat Graph ─────────────────────────────────────────────────────────────
router.get("/threat-graph", async (req, res) => {
  const events = await db
    .select()
    .from(securityEventsTable)
    .orderBy(securityEventsTable.timestamp)
    .limit(60);

  const nodes = events.map((e) => ({
    id: e.nodeId,
    event: e.event,
    score: e.score,
    action: e.action,
    tactic: e.tactic,
    status: e.status,
    timestamp: e.timestamp.toISOString(),
  }));

  const edges: string[][] = [];
  for (let i = 1; i < events.length; i++) {
    edges.push([events[i - 1].nodeId, events[i].nodeId]);
  }

  res.json({ nodes, edges });
});

// ─── Real System Metrics ──────────────────────────────────────────────────────
// Reads actual /proc/stat and /proc/meminfo from the host — not simulated.
// This gives the SOC operator ground truth about host health during an incident.
router.get("/system-metrics", async (req, res) => {
  const metrics = await getSystemMetrics();
  res.json(metrics);
});

// ─── MITRE ATT&CK Stats ───────────────────────────────────────────────────────
// Groups events by ATT&CK tactic with avg risk score.
// Enables the operator to see which kill-chain phases are most active.
router.get("/mitre-stats", async (req, res) => {
  const rows = await db
    .select({
      tactic: securityEventsTable.tactic,
      count: count(),
      avgScore: sql<number>`ROUND(AVG(score)::numeric, 1)`,
    })
    .from(securityEventsTable)
    .groupBy(securityEventsTable.tactic)
    .orderBy(desc(count()));

  const stats = rows
    .filter((r) => r.tactic !== null)
    .map((r) => ({
      tactic: r.tactic as string,
      count: Number(r.count),
      avgScore: Number(r.avgScore),
    }));

  res.json(stats);
});

// ─── Risk Timeline ────────────────────────────────────────────────────────────
// Returns hourly avg risk score for the last 24 hours.
// Powers the time-series chart showing when the system is under peak attack.
router.get("/risk-timeline", async (req, res) => {
  const result = await db.execute(sql`
    SELECT
      date_trunc('hour', timestamp) AS hour,
      ROUND(AVG(score)::numeric, 1) AS avg_score,
      COUNT(*)::int AS count
    FROM security_events
    WHERE timestamp >= NOW() - INTERVAL '24 hours'
    GROUP BY hour
    ORDER BY hour ASC
  `);

  const rawRows = Array.isArray(result) ? result : (result as unknown as { rows: unknown[] }).rows ?? [];
  const timeline = (rawRows as Array<{ hour: Date | string; avg_score: string; count: number }>).map((r) => ({
    hour: r.hour instanceof Date ? r.hour.toISOString() : String(r.hour),
    avgScore: Number(r.avg_score),
    count: Number(r.count),
  }));

  res.json(timeline);
});

export default router;
