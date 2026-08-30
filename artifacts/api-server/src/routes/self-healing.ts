import { Router } from "express";
import { requireCapability, singleTenantScope } from "../middlewares/principal";
import {
  db,
  managedResourcesTable,
  securityEventsTable,
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

router.get("/self-healing/resources", requireCapability("self_healing:preview", singleTenantScope), async (req, res) => {
  const tenantId = req.principal!.tenantIds[0]!;
  const parsed = ListManagedResourcesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid resource query" });
    return;
  }

  const rows = await db
    .select()
    .from(managedResourcesTable)
    .where(eq(managedResourcesTable.tenantId, tenantId))
    .orderBy(desc(managedResourcesTable.updatedAt))
    .limit(parsed.data.limit ?? 100);

  res.json(rows.map(formatManagedResource));
});

router.post("/self-healing/resources", requireCapability("self_healing:apply", singleTenantScope), async (req, res) => {
  const tenantId = req.principal!.tenantIds[0]!;
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
    // A body tenant selector is never authoritative.
    tenantId,
    resourceKey: parsed.data.resourceKey,
    location: parsed.data.location,
    state: parsed.data.state,
  });

  res.status(201).json({
    resource: formatManagedResource(result.resource),
    restorePoint: formatRestorePoint(result.restorePoint),
  });
});

router.get("/self-healing/restore-points", requireCapability("self_healing:preview", singleTenantScope), async (req, res) => {
  const tenantId = req.principal!.tenantIds[0]!;
  const parsed = ListRestorePointsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid restore-point query" });
    return;
  }

  const filters = [];
  if (parsed.data.resourceKey) filters.push(eq(selfHealingRestorePointsTable.resourceKey, parsed.data.resourceKey));
  filters.push(eq(selfHealingRestorePointsTable.tenantId, tenantId));

  const rows = await db
    .select()
    .from(selfHealingRestorePointsTable)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(selfHealingRestorePointsTable.createdAt))
    .limit(parsed.data.limit ?? 100);

  res.json(rows.map(formatRestorePoint));
});

router.get("/self-healing/actions", requireCapability("self_healing:preview", singleTenantScope), async (req, res) => {
  const tenantId = req.principal!.tenantIds[0]!;
  const parsed = ListSelfHealingActionsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid self-healing action query" });
    return;
  }

  const filters = [];
  if (parsed.data.resourceKey) filters.push(eq(selfHealingActionsTable.resourceKey, parsed.data.resourceKey));
  filters.push(eq(selfHealingActionsTable.tenantId, tenantId));

  const rows = await db
    .select()
    .from(selfHealingActionsTable)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(selfHealingActionsTable.createdAt))
    .limit(parsed.data.limit ?? 100);

  res.json(rows.map(formatAction));
});

router.post("/self-healing/restore-points/:id/preview", requireCapability("self_healing:preview", singleTenantScope), async (req, res) => {
  const tenantId = req.principal!.tenantIds[0]!;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "Invalid restore point id" });
    return;
  }

  // Addressed records are loaded in the authorized tenant before side effects.
  const [restorePoint] = await db.select().from(selfHealingRestorePointsTable)
    .where(and(eq(selfHealingRestorePointsTable.id, id), eq(selfHealingRestorePointsTable.tenantId, tenantId))).limit(1);
  if (!restorePoint) {
    res.status(404).json({ error: "Restore point or managed resource not found" });
    return;
  }
  const result = await previewVerifiedRestorePoint(id, tenantId);
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

router.post("/self-healing/restore-points/:id/apply", requireCapability("self_healing:apply", singleTenantScope), async (req, res) => {
  const tenantId = req.principal!.tenantIds[0]!;
  const id = Number(req.params.id);
  const parsed = ApplyRestorePointBody.safeParse(req.body ?? {});
  if (!Number.isInteger(id) || id < 1 || !parsed.success) {
    res.status(400).json({ error: "Invalid restore request" });
    return;
  }
  const [restorePoint] = await db.select().from(selfHealingRestorePointsTable)
    .where(and(eq(selfHealingRestorePointsTable.id, id), eq(selfHealingRestorePointsTable.tenantId, tenantId))).limit(1);
  if (!restorePoint) {
    res.status(404).json({ error: "Restore point or managed resource not found" });
    return;
  }
  if (parsed.data.eventId) {
    const [event] = await db.select({ id: securityEventsTable.id }).from(securityEventsTable)
      .where(and(eq(securityEventsTable.id, parsed.data.eventId), eq(securityEventsTable.tenantId, tenantId))).limit(1);
    if (!event) {
      res.status(404).json({ error: "Security event not found" });
      return;
    }
  }

  const result = await applyVerifiedRestorePoint({
    restorePointId: id,
    tenantId,
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