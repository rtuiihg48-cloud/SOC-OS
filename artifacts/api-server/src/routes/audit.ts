import { Router } from "express";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { auditRecordsTable, db } from "@workspace/db";
import { requireCapability } from "../middlewares/principal";
import { verifyAudit } from "../lib/audit";
import { ListAuditRecordsResponse, VerifyAuditChainResponse } from "@workspace/api-zod";

const router = Router();
const tenantFromQuery = (req: any): number | null => req.principal?.tenantIds.length === 1 ? req.principal.tenantIds[0] : Number(req.query.tenantId) || null;
router.get("/audit/records", requireCapability("audit:read", tenantFromQuery), async (req, res): Promise<void> => {
  const tenantId = tenantFromQuery(req);
  if (tenantId === null) { res.status(400).json({ error: "TENANT_SCOPE_REQUIRED", code: "TENANT_SCOPE_REQUIRED" }); return; }
  if (req.query.tenantId && Number(req.query.tenantId) !== tenantId) { res.status(403).json({ error: "TENANT_SCOPE_MISMATCH", code: "TENANT_SCOPE_MISMATCH" }); return; }
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const cursor = req.query.cursor ? Number(req.query.cursor) : undefined;
  const predicates = [eq(auditRecordsTable.tenantId, tenantId)];
  if (cursor) predicates.push(lt(auditRecordsTable.id, cursor));
  const rows = await db.select().from(auditRecordsTable).where(and(...predicates)).orderBy(desc(auditRecordsTable.id)).limit(limit + 1);
  const page = rows.slice(0, limit).map(({ metadata: _metadata, ...record }) => record);
  res.json(ListAuditRecordsResponse.parse({ records: page, nextCursor: rows.length > limit ? String(page.at(-1)?.id) : null }));
});
router.post("/audit/verify", requireCapability("audit:verify", tenantFromQuery), async (req, res): Promise<void> => {
  const tenantId = tenantFromQuery(req);
  if (tenantId === null || (req.body.tenantId && Number(req.body.tenantId) !== tenantId)) { res.status(403).json({ error: "TENANT_SCOPE_MISMATCH", code: "TENANT_SCOPE_MISMATCH" }); return; }
  const from = req.body.from ? new Date(req.body.from) : undefined; const to = req.body.to ? new Date(req.body.to) : undefined;
  if ((from && Number.isNaN(from.valueOf())) || (to && Number.isNaN(to.valueOf()))) { res.status(400).json({ error: "INVALID_REQUEST", code: "INVALID_REQUEST" }); return; }
  res.json(VerifyAuditChainResponse.parse(await verifyAudit(db, tenantId, from, to)));
});
// This is a diagnostic, not an assertion that an owner cannot bypass PostgreSQL
// ACLs. Production deployment must expose a distinct API role and grant it only
// SELECT/INSERT; a missing trigger/table is explicitly reported as degraded.
router.get("/audit/health", requireCapability("audit:verify", tenantFromQuery), async (_req, res): Promise<void> => {
  const result = await db.execute(sql`
    SELECT to_regclass('public.audit_records') IS NOT NULL AS table_exists,
      EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.audit_records'::regclass
              AND tgname = 'audit_records_immutable' AND NOT tgisinternal) AS trigger_exists`);
  const ready = Boolean(result.rows[0]?.table_exists && result.rows[0]?.trigger_exists);
  res.status(ready ? 200 : 503).json({ ready, code: ready ? "AUDIT_ENFORCEMENT_READY" : "AUDIT_ENFORCEMENT_UNAVAILABLE" });
});
export default router;