import { Router } from "express";
import { db, securityEventsTable, patchesTable } from "@workspace/db";
import { desc, eq, and } from "drizzle-orm";
import {
  buildEventResult,
  autoFix,
  runSelfRedTeam,
  computeNodeId,
  computeHash,
} from "../lib/soc-engine";
import {
  ProcessEventBody,
  UpdateEventStatusBody,
  ListEventsQueryParams,
} from "@workspace/api-zod";

const router = Router();

// ─── List Events ─────────────────────────────────────────────────────────────
// Supports filtering by action, status, and tactic — essential for alert
// management workflows (e.g. show only NEW ISOLATE events).
router.get("/events", async (req, res) => {
  const parsed = ListEventsQueryParams.safeParse(req.query);
  const filters = parsed.success ? parsed.data : {};

  const events = await db
    .select()
    .from(securityEventsTable)
    .orderBy(desc(securityEventsTable.timestamp))
    .limit(filters.limit ?? 200);

  const filtered = events
    .filter((e) => !filters.action || e.action === filters.action)
    .filter((e) => !filters.status || e.status === filters.status)
    .filter((e) => !filters.tactic || e.tactic === filters.tactic);

  res.json(filtered.map(formatEvent));
});

// ─── Process Event ────────────────────────────────────────────────────────────
// Core SOC intake — runs detection engine, computes MITRE mapping and velocity,
// writes to immutable chain, emits SSE to connected clients.
router.post("/events", async (req, res) => {
  const parsed = ProcessEventBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { event, cpuUsage, memUsage } = parsed.data;

  const last = await db
    .select({ hash: securityEventsTable.hash })
    .from(securityEventsTable)
    .orderBy(desc(securityEventsTable.timestamp))
    .limit(1);

  const prevHash = last[0]?.hash ?? "GENESIS";
  const result = buildEventResult(event, prevHash, cpuUsage ?? 0, memUsage ?? 0);

  const [inserted] = await db
    .insert(securityEventsTable)
    .values({
      event: result.event,
      score: result.score,
      action: result.action,
      status: "NEW",
      tactic: result.tactic,
      technique: result.technique,
      techniqueId: result.techniqueId,
      velocityFlag: result.velocityFlag,
      nodeId: result.nodeId,
      hash: result.hash,
      prevHash: result.prevHash,
      cpuUsage: cpuUsage ?? null,
      memUsage: memUsage ?? null,
    })
    .returning();

  const formatted = formatEvent(inserted);

  // Emit SSE to all connected clients
  sseClients.forEach((send) => send(formatted));

  res.json(formatted);
});

// ─── SSE Stream ───────────────────────────────────────────────────────────────
// MUST be registered before /events/:id so Express doesn't try to parse
// the literal string "stream" as a numeric id param.
type SseSend = (data: unknown) => void;
export const sseClients = new Set<SseSend>();

router.get("/events/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send: SseSend = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  sseClients.add(send);
  res.write(": connected\n\n");

  req.on("close", () => {
    sseClients.delete(send);
  });
});

// ─── Get Single Event ─────────────────────────────────────────────────────────
router.get("/events/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [event] = await db
    .select()
    .from(securityEventsTable)
    .where(eq(securityEventsTable.id, id));

  if (!event) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(formatEvent(event));
});

// ─── Update Alert Status ──────────────────────────────────────────────────────
// Alert lifecycle management: NEW → ACKNOWLEDGED → INVESTIGATING → RESOLVED
// This is the key enterprise workflow feature — analysts triage and close alerts.
router.patch("/events/:id/status", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const parsed = UpdateEventStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid status" });
    return;
  }

  const [updated] = await db
    .update(securityEventsTable)
    .set({ status: parsed.data.status })
    .where(eq(securityEventsTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(formatEvent(updated));
});

// ─── Self Red-Team ────────────────────────────────────────────────────────────
router.post("/self-test", async (req, res) => {
  const last = await db
    .select({ hash: securityEventsTable.hash })
    .from(securityEventsTable)
    .orderBy(desc(securityEventsTable.timestamp))
    .limit(1);

  const prevHash = last[0]?.hash ?? "GENESIS";
  const redTeamResults = runSelfRedTeam(prevHash);

  const vulnerabilities = [];
  let patchesApplied = 0;

  for (const { result, fix } of redTeamResults) {
    await db.insert(securityEventsTable).values({
      event: result.event,
      score: result.score,
      action: result.action,
      status: "NEW",
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
      await db.insert(securityEventsTable).values({
        event: `SELF_FIX: ${fix}`,
        score: 0,
        action: "PATCHED",
        status: "RESOLVED",
        tactic: result.tactic,
        technique: result.technique,
        techniqueId: result.techniqueId,
        velocityFlag: false,
        nodeId: computeNodeId(`SELF_FIX: ${fix}`),
        hash: fixHash,
        prevHash: result.hash,
      });

      await db.insert(patchesTable).values({
        attack: result.event,
        fix,
        tactic: result.tactic,
      });

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

  const maxScore = Math.max(...vulnerabilities.map((v) => v.score), 0);
  const systemStatus = maxScore >= 15 ? "CRITICAL" : maxScore >= 7 ? "ALERT" : "MONITORING";

  res.json({ vulnerabilities, patchesApplied, systemStatus });
});

// ─── Full Simulation ──────────────────────────────────────────────────────────
router.post("/simulate", async (req, res) => {
  const last = await db
    .select({ hash: securityEventsTable.hash })
    .from(securityEventsTable)
    .orderBy(desc(securityEventsTable.timestamp))
    .limit(1);

  const prevHash = last[0]?.hash ?? "GENESIS";
  const baseResult = buildEventResult("user login scan attempt", prevHash, 45, 60);

  const [baseEvent] = await db
    .insert(securityEventsTable)
    .values({
      event: baseResult.event,
      score: baseResult.score,
      action: baseResult.action,
      status: "NEW",
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
    await db.insert(securityEventsTable).values({
      event: result.event,
      score: result.score,
      action: result.action,
      status: "NEW",
      tactic: result.tactic,
      technique: result.technique,
      techniqueId: result.techniqueId,
      velocityFlag: result.velocityFlag,
      nodeId: result.nodeId,
      hash: result.hash,
      prevHash: result.prevHash,
    });

    if (fix) {
      await db.insert(patchesTable).values({ attack: result.event, fix, tactic: result.tactic });
      selfHealingEvents.push({ attack: result.event, tactic: result.tactic, fix });
      patchesApplied++;
    }
  }

  res.json({
    baseEvent: formatEvent(baseEvent),
    selfHealingEvents,
    totalProcessed: redTeamResults.length + 1,
    patchesApplied,
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
