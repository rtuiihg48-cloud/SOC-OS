import { Router, type IRouter, type Response } from "express";
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

const router: IRouter = Router();

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
    });
    res.json(GetMetaCubeHealthResponse.parse(data));
  } catch (error) {
    req.log.warn({ err: error }, "META-CUBE health request failed");
    sendError(res, error);
  }
});

router.get("/meta-cube/executions", async (req, res): Promise<void> => {
  const query = ListMetaCubeExecutionsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  try {
    const data = await callMetaCube("v1/executions", {
      query: query.data,
      correlationId: String(req.id),
    });
    res.json(ListMetaCubeExecutionsResponse.parse(data));
  } catch (error) {
    req.log.warn({ err: error }, "META-CUBE executions request failed");
    sendError(res, error);
  }
});

router.post("/meta-cube/executions", async (req, res): Promise<void> => {
  const body = CreateMetaCubeExecutionBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  try {
    const data = await callMetaCube("v1/events", {
      method: "POST",
      body: body.data,
      correlationId: String(req.id),
    });
    res.status(202).json(GetMetaCubeExecutionResponse.parse(data));
  } catch (error) {
    req.log.warn({ err: error }, "META-CUBE execution submission failed");
    sendError(res, error);
  }
});

router.get("/meta-cube/executions/:id", async (req, res): Promise<void> => {
  const params = GetMetaCubeExecutionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  try {
    const data = await callMetaCube(`v1/executions/${encodeURIComponent(params.data.id)}`, {
      correlationId: String(req.id),
    });
    res.json(GetMetaCubeExecutionResponse.parse(data));
  } catch (error) {
    sendError(res, error);
  }
});

router.post("/meta-cube/executions/:id/retry", async (req, res): Promise<void> => {
  const params = RetryMetaCubeExecutionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  try {
    const data = await callMetaCube(
      `v1/executions/${encodeURIComponent(params.data.id)}/retry`,
      { method: "POST", correlationId: String(req.id) },
    );
    res.status(202).json(GetMetaCubeExecutionResponse.parse(data));
  } catch (error) {
    sendError(res, error);
  }
});

router.post("/meta-cube/executions/:id/recover", async (req, res): Promise<void> => {
  const params = RecoverMetaCubeExecutionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  try {
    const data = await callMetaCube(
      `v1/executions/${encodeURIComponent(params.data.id)}/recover`,
      { method: "POST", correlationId: String(req.id) },
    );
    res.status(202).json(GetMetaCubeExecutionResponse.parse(data));
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/meta-cube/dlq", async (req, res): Promise<void> => {
  const query = ListMetaCubeDlqQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  try {
    const data = await callMetaCube("v1/dlq", {
      query: query.data,
      correlationId: String(req.id),
    });
    res.json(ListMetaCubeDlqResponse.parse(data));
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/meta-cube/checkpoints", async (req, res): Promise<void> => {
  const query = ListMetaCubeCheckpointsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  try {
    const data = await callMetaCube("v1/checkpoints", {
      query: query.data,
      correlationId: String(req.id),
    });
    res.json(ListMetaCubeCheckpointsResponse.parse(data));
  } catch (error) {
    sendError(res, error);
  }
});

export default router;