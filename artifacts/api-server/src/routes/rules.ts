import { Router } from "express";
import { db, rulesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { DEFAULT_SYSTEM_RULES } from "../lib/rules-engine";
import { requireCapability, singleTenantScope } from "../middlewares/principal";
import { appendAudit } from "../lib/audit";

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

  const [rule] = await db.transaction(async (tx) => {
    const [created] = await tx.insert(rulesTable).values({
      tenantId,
      name: name.trim(),
      description: description ?? null,
      matchPattern: matchPattern.trim(),
      scoreBoost: scoreBoost ?? 0,
      forceAction: forceAction ?? null,
      severity: severity ?? "medium",
      enabled: enabled ?? true,
    }).returning();
    await appendAudit(tx, { tenantId, principal: req.principal!, action: "rules:create", targetType: "rule", targetId: String(created.id), decision: "COMMITTED", reasonCode: "RULE_CREATED", correlationId: req.principal!.correlationId, metadata: { severity: created.severity, enabled: created.enabled } });
    return [created];
  });

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

  const [rule] = await db.transaction(async (tx) => {
    const [updated] = await tx.update(rulesTable).set(updates).where(and(eq(rulesTable.id, id), eq(rulesTable.tenantId, req.principal!.tenantIds[0]!))).returning();
    if (updated) await appendAudit(tx, { tenantId: updated.tenantId, principal: req.principal!, action: "rules:update", targetType: "rule", targetId: String(updated.id), decision: "COMMITTED", reasonCode: "RULE_UPDATED", correlationId: req.principal!.correlationId, metadata: { fields: Object.keys(updates) } });
    return [updated];
  });
  if (!rule) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmt(rule));
});

router.patch("/rules/:id/toggle", requireCapability("rules:write", singleTenantScope), async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { enabled } = req.body as { enabled?: boolean };
  if (typeof enabled !== "boolean") { res.status(400).json({ error: "enabled (boolean) required" }); return; }

  const [rule] = await db.transaction(async (tx) => {
    const [updated] = await tx.update(rulesTable).set({ enabled }).where(and(eq(rulesTable.id, id), eq(rulesTable.tenantId, req.principal!.tenantIds[0]!))).returning();
    if (updated) await appendAudit(tx, { tenantId: updated.tenantId, principal: req.principal!, action: "rules:enable", targetType: "rule", targetId: String(updated.id), decision: "COMMITTED", reasonCode: "RULE_ENABLED_STATE_UPDATED", correlationId: req.principal!.correlationId, metadata: { enabled } });
    return [updated];
  });
  if (!rule) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmt(rule));
});

router.delete("/rules/:id", requireCapability("rules:write", singleTenantScope), async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [deleted] = await db.transaction(async (tx) => {
    const [row] = await tx.delete(rulesTable).where(and(eq(rulesTable.id, id), eq(rulesTable.tenantId, req.principal!.tenantIds[0]!))).returning();
    if (row) await appendAudit(tx, { tenantId: row.tenantId, principal: req.principal!, action: "rules:delete", targetType: "rule", targetId: String(row.id), decision: "COMMITTED", reasonCode: "RULE_DELETED", correlationId: req.principal!.correlationId });
    return [row];
  });
  if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
  res.status(204).send();
});

export default router;
