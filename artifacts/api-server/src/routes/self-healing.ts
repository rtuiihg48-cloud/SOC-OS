import { Router } from "express";
import {
  db,
  managedResourcesTable,
  selfHealingActionsTable,
  selfHealingRestorePointsTable,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import {
  ApplyRestorePointBody,
  ListManagedResourcesQueryParams,
  ListRestorePointsQueryParams,
  ListSelfHealingActionsQueryParams,
  RegisterManagedResourceBody,
} from "@workspace/api-zod";
import {
  applyVerifiedRestorePoint,
  managedStateSize,
  previewVerifiedRestorePoint,
  registerVerifiedManagedResource,
  SELF_HEALING_POLICY,
} from "../lib/self-healing";

const router = Router();

router.get("/self-healing/resources", async (req, res) => {
  const parsed = ListManagedResourcesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid resource query" });
    return;
  }

  const rows = await db
    .select()
    .from(managedResourcesTable)
    .where(parsed.data.tenantId ? eq(managedResourcesTable.tenantId, parsed.data.tenantId) : undefined)
    .orderBy(desc(managedResourcesTable.updatedAt))
    .limit(parsed.data.limit ?? 100);

  res.json(rows.map(formatManagedResource));
});

router.post("/self-healing/resources", async (req, res) => {
  const parsed = RegisterManagedResourceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid managed resource" });
    return;
  }
  if (managedStateSize(parsed.data.state) > SELF_HEALING_POLICY.maxStateBytes) {
    res.status(400).json({ error: "Managed state exceeds the 64 KB policy limit" });
    return;
  }

  const result = await registerVerifiedManagedResource({
    tenantId: parsed.data.tenantId ?? null,
    resourceKey: parsed.data.resourceKey,
    location: parsed.data.location,
    state: parsed.data.state,
  });

  res.status(201).json({
    resource: formatManagedResource(result.resource),
    restorePoint: formatRestorePoint(result.restorePoint),
  });
});

router.get("/self-healing/restore-points", async (req, res) => {
  const parsed = ListRestorePointsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid restore-point query" });
    return;
  }

  const filters = [];
  if (parsed.data.resourceKey) filters.push(eq(selfHealingRestorePointsTable.resourceKey, parsed.data.resourceKey));
  if (parsed.data.tenantId) filters.push(eq(selfHealingRestorePointsTable.tenantId, parsed.data.tenantId));

  const rows = await db
    .select()
    .from(selfHealingRestorePointsTable)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(selfHealingRestorePointsTable.createdAt))
    .limit(parsed.data.limit ?? 100);

  res.json(rows.map(formatRestorePoint));
});

router.get("/self-healing/actions", async (req, res) => {
  const parsed = ListSelfHealingActionsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid self-healing action query" });
    return;
  }

  const filters = [];
  if (parsed.data.resourceKey) filters.push(eq(selfHealingActionsTable.resourceKey, parsed.data.resourceKey));
  if (parsed.data.tenantId) filters.push(eq(selfHealingActionsTable.tenantId, parsed.data.tenantId));

  const rows = await db
    .select()
    .from(selfHealingActionsTable)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(selfHealingActionsTable.createdAt))
    .limit(parsed.data.limit ?? 100);

  res.json(rows.map(formatAction));
});

router.post("/self-healing/restore-points/:id/preview", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "Invalid restore point id" });
    return;
  }

  const result = await previewVerifiedRestorePoint(id);
  if (!result) {
    res.status(404).json({ error: "Restore point or managed resource not found" });
    return;
  }
  if (!result.canRestore) {
    res.status(409).json(result);
    return;
  }
  res.json(result);
});

router.post("/self-healing/restore-points/:id/apply", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = ApplyRestorePointBody.safeParse(req.body ?? {});
  if (!Number.isInteger(id) || id < 1 || !parsed.success) {
    res.status(400).json({ error: "Invalid restore request" });
    return;
  }

  const result = await applyVerifiedRestorePoint({
    restorePointId: id,
    eventId: parsed.data.eventId ?? null,
    mode: "APPLY",
  });
  if (!result) {
    res.status(404).json({ error: "Restore point or managed resource not found" });
    return;
  }
  if (!result.integrityVerified) {
    res.status(409).json({
      resource: formatManagedResource(result.resource),
      action: formatAction(result.action),
      integrityVerified: false,
      executionAllowed: false,
    });
    return;
  }

  res.json({
    resource: formatManagedResource(result.resource),
    action: formatAction(result.action),
    integrityVerified: result.integrityVerified,
    executionAllowed: result.executionAllowed,
  });
});

function formatManagedResource(row: typeof managedResourcesTable.$inferSelect) {
  return { ...row, updatedAt: row.updatedAt.toISOString() };
}

function formatRestorePoint(row: typeof selfHealingRestorePointsTable.$inferSelect) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    verifiedAt: row.verifiedAt.toISOString(),
  };
}

export function formatAction(row: typeof selfHealingActionsTable.$inferSelect) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

export default router;