import { Router } from "express";
import { db, rulesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { DEFAULT_SYSTEM_RULES } from "../lib/rules-engine";
import { requireCapability, singleTenantScope } from "../middlewares/principal";

const router = Router();

const fmt = (r: typeof rulesTable.$inferSelect) => ({
  ...r,
  createdAt: r.createdAt.toISOString(),
});

router.get("/rules", requireCapability("rules:read", singleTenantScope), async (req, res) => {
  const tenantId = req.principal!.tenantIds[0]!;
  const rules = await db.select().from(rulesTable).where(eq(rulesTable.tenantId, tenantId)).orderBy(rulesTable.createdAt);
  res.json(rules.map(fmt));
});

router.post("/rules", requireCapability("rules:write", singleTenantScope), async (req, res) => {
  const { name, description, matchPattern, scoreBoost, forceAction, severity, enabled } = req.body;
  const tenantId = req.principal!.tenantIds[0]!;

  if (!name?.trim() || !matchPattern?.trim()) {
    res.status(400).json({ error: "name and matchPattern are required" });
    return;
  }

  const [rule] = await db
    .insert(rulesTable)
    .values({
      tenantId,
      name: name.trim(),
      description: description ?? null,
      matchPattern: matchPattern.trim(),
      scoreBoost: scoreBoost ?? 0,
      forceAction: forceAction ?? null,
      severity: severity ?? "medium",
      enabled: enabled ?? true,
    })
    .returning();

  res.status(201).json(fmt(rule));
});

router.patch("/rules/:id", requireCapability("rules:write", singleTenantScope), async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { name, description, matchPattern, scoreBoost, forceAction, severity, enabled } = req.body;

  const updates: Partial<typeof rulesTable.$inferInsert> = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (matchPattern !== undefined) updates.matchPattern = matchPattern;
  if (scoreBoost !== undefined) updates.scoreBoost = scoreBoost;
  if (forceAction !== undefined) updates.forceAction = forceAction;
  if (severity !== undefined) updates.severity = severity;
  if (enabled !== undefined) updates.enabled = enabled;

  const [rule] = await db.update(rulesTable).set(updates).where(and(eq(rulesTable.id, id), eq(rulesTable.tenantId, req.principal!.tenantIds[0]!))).returning();
  if (!rule) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmt(rule));
});

router.patch("/rules/:id/toggle", requireCapability("rules:write", singleTenantScope), async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { enabled } = req.body as { enabled?: boolean };
  if (typeof enabled !== "boolean") { res.status(400).json({ error: "enabled (boolean) required" }); return; }

  const [rule] = await db.update(rulesTable).set({ enabled }).where(and(eq(rulesTable.id, id), eq(rulesTable.tenantId, req.principal!.tenantIds[0]!))).returning();
  if (!rule) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmt(rule));
});

router.delete("/rules/:id", requireCapability("rules:write", singleTenantScope), async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(rulesTable).where(and(eq(rulesTable.id, id), eq(rulesTable.tenantId, req.principal!.tenantIds[0]!)));
  res.status(204).send();
});

export default router;
