import { Router } from "express";
import { db, correlationsTable } from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import { requireCapability, singleTenantScope } from "../middlewares/principal";
import { appendAudit } from "../lib/audit";

const router = Router();

const fmt = (c: typeof correlationsTable.$inferSelect) => ({
  ...c,
  createdAt: c.createdAt.toISOString(),
  resolvedAt: c.resolvedAt ? c.resolvedAt.toISOString() : null,
});

router.get("/correlations", requireCapability("events:read", singleTenantScope), async (req, res) => {
  const tenantId = req.principal!.tenantIds[0]!;
  const severity = req.query.severity as string | undefined;

  const correlations = await db
    .select()
    .from(correlationsTable)
    .where(and(eq(correlationsTable.tenantId, tenantId), severity ? eq(correlationsTable.severity, severity.toUpperCase()) : undefined))
    .orderBy(desc(correlationsTable.createdAt));
  res.json(correlations.map(fmt));
});

router.patch("/correlations/:id/resolve", requireCapability("events:status:update", singleTenantScope), async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [updated] = await db.transaction(async (tx) => {
    const [row] = await tx.update(correlationsTable).set({ resolvedAt: new Date() })
      .where(and(eq(correlationsTable.id, id), eq(correlationsTable.tenantId, req.principal!.tenantIds[0]!))).returning();
    if (row) await appendAudit(tx, { tenantId: row.tenantId, principal: req.principal!, action: "correlations:resolve", targetType: "correlation", targetId: String(row.id), decision: "COMMITTED", reasonCode: "CORRELATION_RESOLVED", correlationId: req.principal!.correlationId });
    return [row];
  });

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmt(updated));
});

export default router;
