import { Router } from "express";
import { db, tenantsTable, securityEventsTable } from "@workspace/db";
import { and, eq, count } from "drizzle-orm";
import crypto from "crypto";
import { requireCapability, singleTenantScope } from "../middlewares/principal";

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

  const [tenant] = await db
    .insert(tenantsTable)
    .values({ name: name.trim(), apiKey, plan: plan ?? "starter" })
    .returning();

  const { apiKey: _apiKey, ...safeTenant } = tenant;
  res.status(201).json({ ...safeTenant, eventCount: 0, createdAt: tenant.createdAt.toISOString() });
});

router.get("/tenants/:id", requireCapability("tenants:read", singleTenantScope), async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, req.principal!.tenantIds[0]!));
  if (!tenant) { res.status(404).json({ error: "Not found" }); return; }

  const [row] = await db.select({ count: count() }).from(securityEventsTable).where(eq(securityEventsTable.tenantId, id));
  const { apiKey: _apiKey, ...safeTenant } = tenant;
  res.json({ ...safeTenant, eventCount: Number(row?.count ?? 0), createdAt: tenant.createdAt.toISOString() });
});

router.delete("/tenants/:id", requireCapability("tenants:write", singleTenantScope), async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(tenantsTable).where(and(eq(tenantsTable.id, id), eq(tenantsTable.id, req.principal!.tenantIds[0]!)));
  res.status(204).send();
});

export default router;
