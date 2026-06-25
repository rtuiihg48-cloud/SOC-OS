import { Router } from "express";
import { db, tenantsTable, securityEventsTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import crypto from "crypto";

const router = Router();

router.get("/tenants", async (req, res) => {
  const tenants = await db.select().from(tenantsTable).orderBy(tenantsTable.createdAt);

  const withCounts = await Promise.all(
    tenants.map(async (t) => {
      const [row] = await db
        .select({ count: count() })
        .from(securityEventsTable)
        .where(eq(securityEventsTable.tenantId, t.id));
      return { ...t, eventCount: Number(row?.count ?? 0), createdAt: t.createdAt.toISOString() };
    }),
  );

  res.json(withCounts);
});

router.post("/tenants", async (req, res) => {
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

  res.status(201).json({ ...tenant, eventCount: 0, createdAt: tenant.createdAt.toISOString() });
});

router.get("/tenants/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, id));
  if (!tenant) { res.status(404).json({ error: "Not found" }); return; }

  const [row] = await db.select({ count: count() }).from(securityEventsTable).where(eq(securityEventsTable.tenantId, id));
  res.json({ ...tenant, eventCount: Number(row?.count ?? 0), createdAt: tenant.createdAt.toISOString() });
});

router.delete("/tenants/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(tenantsTable).where(eq(tenantsTable.id, id));
  res.status(204).send();
});

export default router;
