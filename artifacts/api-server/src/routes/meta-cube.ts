import { Router, type IRouter, type Request, type Response } from "express";
import {
  CreateMetaCubeExecutionBody,
  GetMetaCubeExecutionParams,
  GetMetaCubeExecutionResponse,
  GetMetaCubeHealthResponse,
  ListMetaCubeCheckpointsQueryParams,
  ListMetaCubeCheckpointsResponse,
  ListMetaCubeDlqQueryParams,
  ListMetaCubeDlqResponse,
  ListMetaCubeExecutionsQueryParams,
  ListMetaCubeExecutionsResponse,
  RecoverMetaCubeExecutionParams,
  RetryMetaCubeExecutionParams,
} from "@workspace/api-zod";
import { callMetaCube, MetaCubeClientError } from "../lib/meta-cube-client";
import { requireCapability, singleTenantScope } from "../middlewares/principal";
import { db } from "@workspace/db";
import { appendAudit } from "../lib/audit";
import { auditedHandoff, validatedIdempotencyKey } from "../lib/meta-cube-handoff";

const router: IRouter = Router();
function bridgeContext(req: Request, capability: string, idempotencyKey?: string) {
  const tenantId = singleTenantScope(req);
  const principal = req.principal!;
  if (tenantId === null) throw new Error("META-CUBE bridge requires a single tenant scope");
  return { tenantId, principalType: principal.principalType, principalId: principal.principalId, capability, correlationId: String(req.id), idempotencyKey };
}
const healthBridgeContext = (correlationId: string) => ({
  tenantId: 1, principalType: "SERVICE", principalId: "api-server-health", capability: "execution:health", correlationId,
});
async function recordAttempt(
  req: Request,
  action: string,
  targetId: string,
  decision: "QUEUED" | "ACCEPTED" | "FAILED" | "DENIED",
  reasonCode: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const tenantId = singleTenantScope(req);
  await db.transaction((tx) => appendAudit(tx, {
    tenantId, principal: req.principal!, action, targetType: "meta_cube_execution",
    targetId, decision, reasonCode, correlationId: String(req.id), metadata,
  }));
}
async function recordFailedAttempt(req: Request, action: string, targetId: string, error: unknown, idempotencyKey: string): Promise<void> {
  const denied = error instanceof MetaCubeClientError && error.status >= 400 && error.status < 500;
  try {
    await recordAttempt(req, action, targetId, denied ? "DENIED" : "FAILED", denied ? "META_CUBE_REQUEST_DENIED" : "META_CUBE_REQUEST_FAILED", {
      idempotencyKey, upstreamStatus: error instanceof MetaCubeClientError ? error.status : null,
    });
  } catch (auditError) {
    req.log.error({ err: auditError }, "Failed to record META-CUBE failed attempt");
  }
}
function requireIdempotency(req: Request, res: Response, bodyKey?: string): string | undefined {
  // Submission already exposes idempotencyKey in its generated body contract.
  // Retry/recover use the generated client's RequestInit header option.
  const key = validatedIdempotencyKey(req.header("idempotency-key"), bodyKey);
  if (!key) { res.status(400).json({ error: "IDEMPOTENCY_KEY_REQUIRED", code: "IDEMPOTENCY_KEY_REQUIRED" }); return; }
  return key;
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof MetaCubeClientError) {
    res.status(error.status).json(error.data);
    return;
  }
  res.status(500).json({ error: "Unexpected META-CUBE bridge error" });
}

router.get("/meta-cube/health", async (req, res): Promise<void> => {
  try {
    const data = await callMetaCube("healthz", {
      correlationId: String(req.id),
      context: healthBridgeContext(String(req.id)),
    });
    res.json(GetMetaCubeHealthResponse.parse(data));
  } catch (error) {
    req.log.warn({ err: error }, "META-CUBE health request failed");
    sendError(res, error);
  }
});

router.get("/meta-cube/executions", requireCapability("execution:read", singleTenantScope), async (req, res): Promise<void> => {
  const query = ListMetaCubeExecutionsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  try {
    const data = await callMetaCube("v1/executions", {
      query: query.data,
      correlationId: String(req.id),
      context: bridgeContext(req, "execution:read"),
    });
    res.json(ListMetaCubeExecutionsResponse.parse(data));
  } catch (error) {
    req.log.warn({ err: error }, "META-CUBE executions request failed");
    sendError(res, error);
  }
});

router.post("/meta-cube/executions", requireCapability("execution:submit", singleTenantScope), async (req, res): Promise<void> => {
  const body = CreateMetaCubeExecutionBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const idempotencyKey = requireIdempotency(req, res, body.data.idempotencyKey);
  if (!idempotencyKey) return;
  let parsed: ReturnType<typeof GetMetaCubeExecutionResponse.parse>;
  try {
    parsed = await auditedHandoff(
      async () => GetMetaCubeExecutionResponse.parse(await callMetaCube("v1/events", {
        method: "POST", body: { ...body.data, idempotencyKey },
        correlationId: String(req.id), context: bridgeContext(req, "execution:submit", idempotencyKey),
      })),
      async (accepted) => recordAttempt(req, "execution:submit", accepted.id, "QUEUED", "META_CUBE_REQUEST_QUEUED", { idempotencyKey, executionId: accepted.id }),
      async (error) => recordFailedAttempt(req, "execution:submit", idempotencyKey, error, idempotencyKey),
    );
  } catch (error) {
    req.log.warn({ err: error }, "META-CUBE execution submission failed");
    sendError(res, error);
    return;
  }
  res.status(202).json(parsed);
});

router.get("/meta-cube/executions/:id", requireCapability("execution:read", singleTenantScope), async (req, res): Promise<void> => {
  const params = GetMetaCubeExecutionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  try {
    const data = await callMetaCube(`v1/executions/${encodeURIComponent(params.data.id)}`, {
      correlationId: String(req.id),
      context: bridgeContext(req, "execution:read"),
    });
    res.json(GetMetaCubeExecutionResponse.parse(data));
  } catch (error) {
    sendError(res, error);
  }
});

router.post("/meta-cube/executions/:id/retry", requireCapability("execution:retry", singleTenantScope), async (req, res): Promise<void> => {
  const idempotencyKey = requireIdempotency(req, res);
  if (!idempotencyKey) return;
  const params = RetryMetaCubeExecutionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  let parsed: ReturnType<typeof GetMetaCubeExecutionResponse.parse>;
  try {
    parsed = await auditedHandoff(
      async () => GetMetaCubeExecutionResponse.parse(await callMetaCube(
        `v1/executions/${encodeURIComponent(params.data.id)}/retry`,
        { method: "POST", correlationId: String(req.id), context: bridgeContext(req, "execution:retry", idempotencyKey) },
      )),
      async (accepted) => recordAttempt(req, "execution:retry", accepted.id, "ACCEPTED", "META_CUBE_RETRY_ACCEPTED", { idempotencyKey, requestedExecutionId: params.data.id, executionId: accepted.id }),
      async (error) => recordFailedAttempt(req, "execution:retry", params.data.id, error, idempotencyKey),
    );
  } catch (error) {
    sendError(res, error);
    return;
  }
  res.status(202).json(parsed);
});

router.post("/meta-cube/executions/:id/recover", requireCapability("execution:recover", singleTenantScope), async (req, res): Promise<void> => {
  const idempotencyKey = requireIdempotency(req, res);
  if (!idempotencyKey) return;
  const params = RecoverMetaCubeExecutionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  let parsed: ReturnType<typeof GetMetaCubeExecutionResponse.parse>;
  try {
    parsed = await auditedHandoff(
      async () => GetMetaCubeExecutionResponse.parse(await callMetaCube(
        `v1/executions/${encodeURIComponent(params.data.id)}/recover`,
        { method: "POST", correlationId: String(req.id), context: bridgeContext(req, "execution:recover", idempotencyKey) },
      )),
      async (accepted) => recordAttempt(req, "execution:recover", accepted.id, "ACCEPTED", "META_CUBE_RECOVERY_ACCEPTED", { idempotencyKey, requestedExecutionId: params.data.id, executionId: accepted.id }),
      async (error) => recordFailedAttempt(req, "execution:recover", params.data.id, error, idempotencyKey),
    );
  } catch (error) {
    sendError(res, error);
    return;
  }
  res.status(202).json(parsed);
});

router.get("/meta-cube/dlq", requireCapability("execution:dlq:operate", singleTenantScope), async (req, res): Promise<void> => {
  const query = ListMetaCubeDlqQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  try {
    const data = await callMetaCube("v1/dlq", {
      query: query.data,
      correlationId: String(req.id),
      context: bridgeContext(req, "execution:dlq:operate"),
    });
    res.json(ListMetaCubeDlqResponse.parse(data));
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/meta-cube/checkpoints", requireCapability("execution:read", singleTenantScope), async (req, res): Promise<void> => {
  const query = ListMetaCubeCheckpointsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  try {
    const data = await callMetaCube("v1/checkpoints", {
      query: query.data,
      correlationId: String(req.id),
      context: bridgeContext(req, "execution:read"),
    });
    res.json(ListMetaCubeCheckpointsResponse.parse(data));
  } catch (error) {
    sendError(res, error);
  }
});

export default router;