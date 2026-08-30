import { Router } from "express";
import { requireCapability, singleTenantScope } from "../middlewares/principal";
import { and, desc, eq } from "drizzle-orm";
import { db, sandboxQuarantinesTable } from "@workspace/db";

const router = Router();

router.get("/quarantine", requireCapability("quarantine:read", singleTenantScope), async (req, res) => {
  const tenantId = req.principal!.tenantIds[0]!;
  const parsedLimit = Number(req.query.limit);
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 50;
  const requestedStatus = typeof req.query.status === "string" ? req.query.status.toUpperCase() : undefined;

  const captures = await db
    .select()
    .from(sandboxQuarantinesTable)
    .where(and(
      eq(sandboxQuarantinesTable.tenantId, tenantId),
      requestedStatus ? eq(sandboxQuarantinesTable.status, requestedStatus) : undefined,
    ))
    .orderBy(desc(sandboxQuarantinesTable.createdAt))
    .limit(limit);

  res.json(captures.map(formatCapture));
});

router.get("/quarantine/:id", requireCapability("quarantine:read", singleTenantScope), async (req, res) => {
  const tenantId = req.principal!.tenantIds[0]!;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "Invalid quarantine id" });
    return;
  }

  const [capture] = await db
    .select()
    .from(sandboxQuarantinesTable)
    .where(and(eq(sandboxQuarantinesTable.id, id), eq(sandboxQuarantinesTable.tenantId, tenantId)))
    .limit(1);

  if (!capture) {
    res.status(404).json({ error: "Quarantine capture not found" });
    return;
  }

  res.json(formatCapture(capture));
});

function formatCapture(capture: typeof sandboxQuarantinesTable.$inferSelect) {
  return {
    ...capture,
    createdAt: capture.createdAt.toISOString(),
    releasedAt: capture.releasedAt?.toISOString() ?? null,
  };
}

export default router;