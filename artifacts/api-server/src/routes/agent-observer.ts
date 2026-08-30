import { Router, type IRouter } from "express";
import { db, pool, agentObserverRunsTable } from "@workspace/db";
import { analyzeEvent } from "../lib/soc-engine";
import { getSystemMetrics } from "../lib/system-metrics";
import { runObserverAgent, type ObserverInput, type ObserverTaskType } from "../lib/agent-observer";
import { requireCapability, singleTenantScope } from "../middlewares/principal";
import { appendAudit } from "../lib/audit";

const router: IRouter = Router();
const TASK_TYPES = new Set<ObserverTaskType>(["analyze_event", "analyze_system", "inspect_memory"]);

function parseInput(body: unknown): ObserverInput | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  if (typeof value.taskType !== "string" || !TASK_TYPES.has(value.taskType as ObserverTaskType)) return null;
  if (typeof value.instruction !== "string" || value.instruction.trim().length === 0 || value.instruction.length > 2_000) {
    return null;
  }
  if (value.event !== undefined && (typeof value.event !== "string" || value.event.length > 10_000)) return null;
  if (
    value.tenantId !== undefined &&
    (!Number.isInteger(value.tenantId) || Number(value.tenantId) <= 0)
  ) {
    return null;
  }
  return {
    taskType: value.taskType as ObserverTaskType,
    instruction: value.instruction.trim(),
    event: typeof value.event === "string" ? value.event.trim() : undefined,
    tenantId: value.tenantId === undefined ? undefined : Number(value.tenantId),
  };
}

async function inspectMemory(tenantId?: number): Promise<Record<string, number>> {
  const tenantFilter = tenantId === undefined ? "" : "WHERE tenant_id = $1";
  const parameters = tenantId === undefined ? [] : [tenantId];
  const [predictions, outcomes, links, layers] = await Promise.all([
    pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM dna_predictions ${tenantFilter}`,
      parameters,
    ),
    pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM dna_outcomes outcome
       JOIN dna_predictions prediction ON prediction.id = outcome.prediction_id
       ${tenantId === undefined ? "" : "WHERE prediction.tenant_id = $1"}`,
      parameters,
    ),
    pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM dna_attack_links link
       JOIN dna_predictions prediction ON prediction.id = link.to_prediction_id
       ${tenantId === undefined ? "" : "WHERE prediction.tenant_id = $1"}`,
      parameters,
    ),
    pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM dna_prediction_layer_observations observation
       JOIN dna_predictions prediction ON prediction.id = observation.prediction_id
       ${tenantId === undefined ? "" : "WHERE prediction.tenant_id = $1"}`,
      parameters,
    ),
  ]);
  return {
    predictions: Number(predictions.rows[0]?.count ?? 0),
    outcomes: Number(outcomes.rows[0]?.count ?? 0),
    attackLinks: Number(links.rows[0]?.count ?? 0),
    layerObservations: Number(layers.rows[0]?.count ?? 0),
  };
}

router.post("/agent/observe", requireCapability("agent:observe", singleTenantScope), async (req, res): Promise<void> => {
  const input = parseInput(req.body);
  if (!input) {
    res.status(400).json({
      error: "Invalid observer request",
      allowedTaskTypes: [...TASK_TYPES],
    });
    return;
  }
  const tenantId = singleTenantScope(req);
  if (tenantId === null || (input.tenantId !== undefined && input.tenantId !== tenantId)) {
    res.status(403).json({ error: "TENANT_SCOPE_MISMATCH", code: "TENANT_SCOPE_MISMATCH" });
    return;
  }
  // Observer reads are always tenant-scoped, including requests that omitted a
  // tenant id. This prevents an authorized tenant principal from observing
  // aggregate cross-tenant memory.
  input.tenantId = tenantId;

  const run = await runObserverAgent(input, {
    async analyzeEvent(event) {
      return analyzeEvent(event, 0, 0, { trackVelocity: false });
    },
    readSystemMetrics: getSystemMetrics,
    inspectMemory,
  });

  await db.transaction(async (tx) => {
    await tx.insert(agentObserverRunsTable).values({
      runId: run.runId,
      tenantId,
      taskType: input.taskType,
      instruction: input.instruction,
      status: run.status,
      policy: run.policy,
      plan: run.plan,
      results: run.results,
      reflection: run.reflection,
      productionChanged: false,
    } as any);
    await appendAudit(tx, {
      tenantId,
      principal: req.principal!,
      action: "agent:observe",
      targetType: "agent_observer_run",
      targetId: run.runId,
      decision: run.status === "completed" ? "COMMITTED" : run.status === "blocked" ? "REJECTED" : "FAILED",
      reasonCode: run.status === "completed" ? "OBSERVER_RUN_RECORDED" : run.status === "blocked" ? "OBSERVER_POLICY_BLOCKED" : "OBSERVER_RUN_FAILED",
      correlationId: req.principal!.correlationId,
      metadata: {
        taskType: input.taskType,
        status: run.status,
        failedSteps: run.results.filter((step) => step.status === "failed").length,
        productionChanged: false,
      },
    });
  });

  res.status(run.status === "blocked" ? 403 : 200).json(run);
});

export default router;