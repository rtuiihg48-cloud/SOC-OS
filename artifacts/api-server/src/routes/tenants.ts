import { Router } from "express";
import { db, tenantsTable, securityEventsTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import crypto from "crypto";
import { requireCapability, singleTenantScope } from "../middlewares/principal";
import { appendAudit } from "../lib/audit";
import { deactivateTenant } from "../lib/tenant-lifecycle";

const router = Router();

router.get("/tenants", requireCapability("tenants:read", singleTenantScope), async (req, res) => {
  const tenantId = req.principal!.tenantIds[0]!;
  const tenants = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId)).orderBy(tenantsTable.createdAt);

  const withCounts = await Promise.all(
    tenants.map(async (t) => {
      const [row] = await db
        .select({ count: count() })
        .from(securityEventsTable)
        .where(eq(securityEventsTable.tenantId, t.id));
      const { apiKey: _apiKey, ...safeTenant } = t;
      return { ...safeTenant, eventCount: Number(row?.count ?? 0), createdAt: t.createdAt.toISOString() };
    }),
  );

  res.json(withCounts);
});

router.post("/tenants", requireCapability("tenants:write", singleTenantScope), async (req, res) => {
  const { name, plan } = req.body as { name?: string; plan?: string };
  if (!name?.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const apiKey = "soc_" + crypto.randomBytes(20).toString("hex");

  const [tenant] = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(tenantsTable)
      .values({ name: name.trim(), apiKey, plan: plan ?? "starter" })
      .returning();
    await appendAudit(tx, {
      tenantId: created.id,
      principal: req.principal!,
      action: "tenants:create",
      targetType: "tenant",
      targetId: String(created.id),
      decision: "COMMITTED",
      reasonCode: "TENANT_CREATED",
      correlationId: req.principal!.correlationId,
      metadata: { plan: created.plan },
    });
    return [created];
  });

  const { apiKey: _apiKey, ...safeTenant } = tenant;
  res.status(201).json({ ...safeTenant, eventCount: 0, createdAt: tenant.createdAt.toISOString() });
});

router.get("/tenants/:id", requireCapability("tenants:read", singleTenantScope), async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const authorizedTenantId = req.principal!.tenantIds[0]!;
  if (id !== authorizedTenantId) { res.status(403).json({ error: "Forbidden" }); return; }

  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, authorizedTenantId));
  if (!tenant) { res.status(404).json({ error: "Not found" }); return; }

  const [row] = await db.select({ count: count() }).from(securityEventsTable).where(eq(securityEventsTable.tenantId, tenant.id));
  const { apiKey: _apiKey, ...safeTenant } = tenant;
  res.json({ ...safeTenant, eventCount: Number(row?.count ?? 0), createdAt: tenant.createdAt.toISOString() });
});

router.delete("/tenants/:id", requireCapability("tenants:write", singleTenantScope), async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const authorizedTenantId = req.principal!.tenantIds[0]!;
  if (id !== authorizedTenantId) { res.status(403).json({ error: "Forbidden" }); return; }
  const tenant = await db.transaction((tx) => deactivateTenant(tx, {
    tenantId: authorizedTenantId,
    principal: req.principal!,
    correlationId: req.principal!.correlationId,
  }));
  if (!tenant) { res.status(404).json({ error: "Not found" }); return; }
  const { apiKey: _apiKey, ...safeTenant } = tenant;
  res.status(200).json({
    ...safeTenant,
    createdAt: tenant.createdAt.toISOString(),
    deactivatedAt: tenant.deactivatedAt?.toISOString() ?? null,
  });
});

export default router;
