import { Router } from "express";
import { requireCapability, singleTenantScope } from "../middlewares/principal";
import {
  NodeExchangeError,
  appendExchangeEnvelope,
  getExchangeHealth,
  getExchangeRoute,
  listExchangeMessages,
  registerExchangeNode,
  updateExchangeNodeStatus,
} from "../lib/node-exchange-ledger";

const router = Router();
const NODE_ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/;

function tenantOrReject(req: Parameters<typeof singleTenantScope>[0]): number {
  const tenantId = singleTenantScope(req);
  if (tenantId === null) throw new NodeExchangeError("TENANT_SCOPE_MISMATCH", 403);
  return tenantId;
}

function handleExchangeError(error: unknown, res: Parameters<Parameters<typeof router.get>[1]>[1]): void {
  if (error instanceof NodeExchangeError) {
    res.status(error.statusCode).json({ error: error.reasonCode, code: error.reasonCode });
    return;
  }
  throw error;
}

router.post("/node-exchange/nodes", requireCapability("node-exchange:admin", singleTenantScope), async (req, res) => {
  try {
    const tenantId = tenantOrReject(req);
    const body = req.body as Record<string, unknown>;
    if (
      !body || typeof body !== "object" ||
      typeof body.nodeId !== "string" ||
      typeof body.role !== "string" ||
      typeof body.publicKey !== "string" ||
      !Number.isSafeInteger(body.keyVersion) ||
      !Array.isArray(body.allowedPeerIds) ||
      body.allowedPeerIds.some((peer) => typeof peer !== "string")
    ) {
      res.status(400).json({ error: "INVALID_NODE_REGISTRATION", code: "INVALID_NODE_REGISTRATION" });
      return;
    }
    const result = await registerExchangeNode({
      tenantId,
      nodeId: body.nodeId,
      role: body.role,
      publicKey: body.publicKey,
      keyVersion: Number(body.keyVersion),
      allowedPeerIds: body.allowedPeerIds as string[],
      principal: req.principal!,
    });
    res.status(201).json(result);
  } catch (error) {
    handleExchangeError(error, res);
  }
});

router.patch("/node-exchange/nodes/:nodeId/:keyVersion/status", requireCapability("node-exchange:admin", singleTenantScope), async (req, res) => {
  try {
    const tenantId = tenantOrReject(req);
    const nodeId = Array.isArray(req.params.nodeId) ? req.params.nodeId[0] : req.params.nodeId;
    const keyVersionValue = Array.isArray(req.params.keyVersion) ? req.params.keyVersion[0] : req.params.keyVersion;
    const keyVersion = Number(keyVersionValue);
    const status = (req.body as Record<string, unknown>)?.status;
    if (
      !nodeId ||
      !NODE_ID.test(nodeId) ||
      !Number.isSafeInteger(keyVersion) ||
      keyVersion <= 0 ||
      (status !== "ACTIVE" && status !== "SUSPENDED" && status !== "REVOKED")
    ) {
      res.status(400).json({ error: "INVALID_NODE_STATUS_UPDATE", code: "INVALID_NODE_STATUS_UPDATE" });
      return;
    }
    res.json(await updateExchangeNodeStatus({
      tenantId,
      nodeId,
      keyVersion,
      status,
      principal: req.principal!,
    }));
  } catch (error) {
    handleExchangeError(error, res);
  }
});

router.post("/node-exchange/messages", requireCapability("node-exchange:submit", singleTenantScope), async (req, res) => {
  try {
    const tenantId = tenantOrReject(req);
    const gatewayNodeId = req.principal?.gatewayScope || req.principal?.principalId || "gateway";
    const result = await appendExchangeEnvelope({
      tenantId,
      principal: req.principal!,
      gatewayNodeId,
      envelopeValue: req.body,
    });
    res.status(result.idempotent ? 200 : 201).json(result);
  } catch (error) {
    handleExchangeError(error, res);
  }
});

router.get("/node-exchange/messages", requireCapability("node-exchange:read", singleTenantScope), async (req, res) => {
  try {
    res.json(await listExchangeMessages(tenantOrReject(req)));
  } catch (error) {
    handleExchangeError(error, res);
  }
});

router.get("/node-exchange/messages/:messageId/route", requireCapability("node-exchange:read", singleTenantScope), async (req, res) => {
  try {
    const tenantId = tenantOrReject(req);
    const messageId = Array.isArray(req.params.messageId) ? req.params.messageId[0] : req.params.messageId;
    if (!messageId || !NODE_ID.test(messageId)) {
      res.status(400).json({ error: "INVALID_MESSAGE_ID", code: "INVALID_MESSAGE_ID" });
      return;
    }
    res.json(await getExchangeRoute(tenantId, messageId));
  } catch (error) {
    handleExchangeError(error, res);
  }
});

router.post("/node-exchange/verify", requireCapability("node-exchange:verify", singleTenantScope), async (req, res) => {
  try {
    const tenantId = tenantOrReject(req);
    const messageId = (req.body as Record<string, unknown>)?.messageId;
    if (typeof messageId !== "string" || !NODE_ID.test(messageId)) {
      res.status(400).json({ error: "INVALID_MESSAGE_ID", code: "INVALID_MESSAGE_ID" });
      return;
    }
    res.json(await getExchangeRoute(tenantId, messageId));
  } catch (error) {
    handleExchangeError(error, res);
  }
});

router.get("/node-exchange/health", requireCapability("node-exchange:verify", singleTenantScope), async (req, res) => {
  try {
    res.json(await getExchangeHealth(tenantOrReject(req)));
  } catch (error) {
    handleExchangeError(error, res);
  }
});

export default router;