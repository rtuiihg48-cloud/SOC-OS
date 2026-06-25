import { Router } from "express";
import { db, correlationsTable } from "@workspace/db";
import { eq, desc, isNull } from "drizzle-orm";

const router = Router();

const fmt = (c: typeof correlationsTable.$inferSelect) => ({
  ...c,
  createdAt: c.createdAt.toISOString(),
  resolvedAt: c.resolvedAt ? c.resolvedAt.toISOString() : null,
});

router.get("/correlations", async (req, res) => {
  const tenantId = req.query.tenantId ? parseInt(req.query.tenantId as string, 10) : undefined;
  const severity = req.query.severity as string | undefined;

  const correlations = await db
    .select()
    .from(correlationsTable)
    .orderBy(desc(correlationsTable.createdAt));

  const filtered = correlations
    .filter((c) => tenantId === undefined || c.tenantId === tenantId)
    .filter((c) => !severity || c.severity === severity.toUpperCase());

  res.json(filtered.map(fmt));
});

router.patch("/correlations/:id/resolve", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [updated] = await db
    .update(correlationsTable)
    .set({ resolvedAt: new Date() })
    .where(eq(correlationsTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmt(updated));
});

export default router;
