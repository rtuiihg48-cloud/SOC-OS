import { Router } from "express";
import { db, securityEventsTable, patchesTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import {
  scoreEvent,
  decideAction,
  computeNodeId,
  computeHash,
  autoFix,
  runSelfRedTeam,
} from "../lib/soc-engine";
import { ProcessEventBody } from "@workspace/api-zod";

const router = Router();

router.get("/events", async (req, res) => {
  const events = await db
    .select()
    .from(securityEventsTable)
    .orderBy(desc(securityEventsTable.timestamp));
  res.json(
    events.map((e) => ({
      ...e,
      timestamp: e.timestamp.toISOString(),
    })),
  );
});

router.post("/events", async (req, res) => {
  const parsed = ProcessEventBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { event, cpuUsage, memUsage } = parsed.data;

  const last = await db
    .select()
    .from(securityEventsTable)
    .orderBy(desc(securityEventsTable.timestamp))
    .limit(1);

  const prevHash = last.length > 0 ? last[0].hash : "GENESIS";
  const score = scoreEvent(event, cpuUsage ?? 0, memUsage ?? 0);
  const action = decideAction(score);
  const nodeId = computeNodeId(event);
  const ts = Date.now();
  const hash = computeHash(event, score, action, prevHash, ts);

  const [inserted] = await db
    .insert(securityEventsTable)
    .values({
      event,
      score,
      action,
      nodeId,
      hash,
      prevHash,
      cpuUsage: cpuUsage ?? null,
      memUsage: memUsage ?? null,
    })
    .returning();

  res.json({
    ...inserted,
    timestamp: inserted.timestamp.toISOString(),
  });
});

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

  res.json({ ...event, timestamp: event.timestamp.toISOString() });
});

router.post("/self-test", async (req, res) => {
  const last = await db
    .select()
    .from(securityEventsTable)
    .orderBy(desc(securityEventsTable.timestamp))
    .limit(1);

  const prevHash = last.length > 0 ? last[0].hash : "GENESIS";
  const redTeamResults = runSelfRedTeam(prevHash);

  const vulnerabilities = [];
  let patchesApplied = 0;

  for (const { result, fix } of redTeamResults) {
    if (fix) {
      await db.insert(securityEventsTable).values({
        event: `SELF_FIX: ${fix}`,
        score: 0,
        action: "PATCHED",
        nodeId: computeNodeId(`SELF_FIX: ${fix}`),
        hash: computeHash(`SELF_FIX: ${fix}`, 0, "PATCHED", result.hash, Date.now()),
        prevHash: result.hash,
      });

      await db.insert(patchesTable).values({
        attack: result.event,
        fix,
      });

      patchesApplied++;
    }

    await db.insert(securityEventsTable).values({
      event: result.event,
      score: result.score,
      action: result.action,
      nodeId: result.nodeId,
      hash: result.hash,
      prevHash: result.prevHash,
    });

    vulnerabilities.push({
      attack: result.event,
      score: result.score,
      action: result.action,
      fix: fix ?? null,
    });
  }

  const maxScore = Math.max(...vulnerabilities.map((v) => v.score));
  const systemStatus =
    maxScore >= 15 ? "CRITICAL" : maxScore >= 7 ? "ALERT" : "MONITORING";

  res.json({ vulnerabilities, patchesApplied, systemStatus });
});

router.post("/simulate", async (req, res) => {
  const last = await db
    .select()
    .from(securityEventsTable)
    .orderBy(desc(securityEventsTable.timestamp))
    .limit(1);

  const prevHash = last.length > 0 ? last[0].hash : "GENESIS";

  const baseScore = scoreEvent("user login scan attempt", 45, 60);
  const baseAction = decideAction(baseScore);
  const baseNodeId = computeNodeId("user login scan attempt");
  const ts = Date.now();
  const baseHash = computeHash("user login scan attempt", baseScore, baseAction, prevHash, ts);

  const [baseEvent] = await db
    .insert(securityEventsTable)
    .values({
      event: "user login scan attempt",
      score: baseScore,
      action: baseAction,
      nodeId: baseNodeId,
      hash: baseHash,
      prevHash,
      cpuUsage: 45,
      memUsage: 60,
    })
    .returning();

  const redTeamResults = runSelfRedTeam(baseHash);
  const selfHealingEvents = [];
  let patchesApplied = 0;

  for (const { result, fix } of redTeamResults) {
    await db.insert(securityEventsTable).values({
      event: result.event,
      score: result.score,
      action: result.action,
      nodeId: result.nodeId,
      hash: result.hash,
      prevHash: result.prevHash,
    });

    if (fix) {
      await db.insert(patchesTable).values({
        attack: result.event,
        fix,
      });
      selfHealingEvents.push({ attack: result.event, fix });
      patchesApplied++;
    }
  }

  res.json({
    baseEvent: { ...baseEvent, timestamp: baseEvent.timestamp.toISOString() },
    selfHealingEvents,
    totalProcessed: redTeamResults.length + 1,
    patchesApplied,
  });
});

export default router;
