import { Router, type IRouter } from "express";
import {
  NodeClusterError,
  nodeClusterManager,
} from "../lib/node-cluster";
import { validateNodeTaskBody } from "../lib/node-task-validation";
import { requireCapability, singleTenantScope } from "../middlewares/principal";

const router: IRouter = Router();

function tenantIdOrThrow(req: Parameters<typeof singleTenantScope>[0]): number {
  const tenantId = singleTenantScope(req);
  if (tenantId === null) throw new NodeClusterError("SINGLE_TENANT_SCOPE_REQUIRED", 403);
  return tenantId;
}

router.get("/node-cluster", requireCapability("dashboard:read", singleTenantScope), (req, res) => {
  res.json(nodeClusterManager.snapshot(tenantIdOrThrow(req)));
});

router.get("/node-cluster/messages", requireCapability("dashboard:read", singleTenantScope), (req, res) => {
  res.json(nodeClusterManager.listMessages(tenantIdOrThrow(req)));
});

router.post("/node-cluster/tasks", requireCapability("testing:run", singleTenantScope), (req, res) => {
  const parsed = validateNodeTaskBody(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "INVALID_NODE_TASK",
      code: "INVALID_NODE_TASK",
      issues: parsed.issues,
    });
    return;
  }
  try {
    const message = nodeClusterManager.dispatch(
      tenantIdOrThrow(req),
      req.principal!.correlationId,
      parsed.data,
    );
    req.log.info({
      messageId: message.messageId,
      taskId: message.taskId,
      destinationNodeId: message.destinationNodeId,
      kind: message.kind,
    }, "Allowlisted node-cluster task dispatched");
    res.status(202).json(message);
  } catch (error) {
    if (error instanceof NodeClusterError) {
      res.status(error.statusCode).json({ error: error.code, code: error.code });
      return;
    }
    throw error;
  }
});

export default router;