import { Router } from "express";
import { db, rulesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { DEFAULT_SYSTEM_RULES } from "../lib/rules-engine";

const router = Router();

const fmt = (r: typeof rulesTable.$inferSelect) => ({
  ...r,
  createdAt: r.createdAt.toISOString(),
});

router.get("/rules", async (req, res) => {
  const tenantId = req.query.tenantId ? parseInt(req.query.tenantId as string, 10) : undefined;
  const rules = await db.select().from(rulesTable).orderBy(rulesTable.createdAt);
  const filtered = tenantId !== undefined
    ? rules.filter((r) => r.tenantId === tenantId || r.tenantId === null)
    : rules;
  res.json(filtered.map(fmt));
});

router.post("/rules", async (req, res) => {
  const { tenantId, name, description, matchPattern, scoreBoost, forceAction, severity, enabled } = req.body;

  if (!name?.trim() || !matchPattern?.trim()) {
    res.status(400).json({ error: "name and matchPattern are required" });
    return;
  }

  const [rule] = await db
    .insert(rulesTable)
    .values({
      tenantId: tenantId ?? null,
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

router.patch("/rules/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
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

  const [rule] = await db.update(rulesTable).set(updates).where(eq(rulesTable.id, id)).returning();
  if (!rule) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmt(rule));
});

router.patch("/rules/:id/toggle", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { enabled } = req.body as { enabled?: boolean };
  if (typeof enabled !== "boolean") { res.status(400).json({ error: "enabled (boolean) required" }); return; }

  const [rule] = await db.update(rulesTable).set({ enabled }).where(eq(rulesTable.id, id)).returning();
  if (!rule) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmt(rule));
});

router.delete("/rules/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(rulesTable).where(eq(rulesTable.id, id));
  res.status(204).send();
});

export default router;
