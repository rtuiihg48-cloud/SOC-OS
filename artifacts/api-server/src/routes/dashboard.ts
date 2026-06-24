import { Router } from "express";
import { db, securityEventsTable, patchesTable } from "@workspace/db";
import { desc, sql, count } from "drizzle-orm";

const router = Router();

router.get("/patches", async (req, res) => {
  const patches = await db
    .select()
    .from(patchesTable)
    .orderBy(desc(patchesTable.appliedAt));
  res.json(
    patches.map((p) => ({
      ...p,
      appliedAt: p.appliedAt.toISOString(),
    })),
  );
});

router.get("/dashboard", async (req, res) => {
  const [totalEventsRow] = await db
    .select({ count: count() })
    .from(securityEventsTable);

  const [totalPatchesRow] = await db
    .select({ count: count() })
    .from(patchesTable);

  const actionCounts = await db
    .select({
      action: securityEventsTable.action,
      count: count(),
    })
    .from(securityEventsTable)
    .groupBy(securityEventsTable.action);

  const [avgRow] = await db
    .select({ avg: sql<number>`AVG(score)` })
    .from(securityEventsTable);

  const recentEvents = await db
    .select()
    .from(securityEventsTable)
    .orderBy(desc(securityEventsTable.timestamp))
    .limit(10);

  const counts = { ALLOW: 0, WARN: 0, ISOLATE: 0, PATCHED: 0 };
  for (const row of actionCounts) {
    const action = row.action as keyof typeof counts;
    if (action in counts) {
      counts[action] = Number(row.count);
    }
  }

  const totalEvents = Number(totalEventsRow?.count ?? 0);
  const totalPatches = Number(totalPatchesRow?.count ?? 0);
  const avgScore = Number(avgRow?.avg ?? 0);
  const threatLevel = Math.min(100, Math.round(avgScore * 5));

  let systemStatus: "SECURE" | "MONITORING" | "ALERT" | "CRITICAL" = "SECURE";
  if (counts.ISOLATE > 0) systemStatus = "CRITICAL";
  else if (counts.WARN > 2) systemStatus = "ALERT";
  else if (totalEvents > 0) systemStatus = "MONITORING";

  res.json({
    totalEvents,
    totalPatches,
    actionCounts: counts,
    systemStatus,
    avgRiskScore: Math.round(avgScore * 10) / 10,
    recentEvents: recentEvents.map((e) => ({
      ...e,
      timestamp: e.timestamp.toISOString(),
    })),
    threatLevel,
  });
});

router.get("/threat-graph", async (req, res) => {
  const events = await db
    .select()
    .from(securityEventsTable)
    .orderBy(securityEventsTable.timestamp)
    .limit(50);

  const nodes = events.map((e) => ({
    id: e.nodeId,
    event: e.event,
    score: e.score,
    action: e.action,
    timestamp: e.timestamp.toISOString(),
  }));

  const edges: string[][] = [];
  for (let i = 1; i < events.length; i++) {
    edges.push([events[i - 1].nodeId, events[i].nodeId]);
  }

  res.json({ nodes, edges });
});

export default router;
