import { and, eq } from "drizzle-orm";
import { serviceCredentialsTable, tenantMembershipsTable, tenantsTable } from "@workspace/db";
import { appendAudit } from "./audit";
import type { Principal } from "./control-policy";

export async function deactivateTenant(
  tx: any,
  input: { tenantId: number; principal: Principal; correlationId: string },
) {
  const [current] = await tx.select().from(tenantsTable)
    .where(eq(tenantsTable.id, input.tenantId)).limit(1);
  if (!current) return null;
  if (current.status === "DISABLED") return current;

  const deactivatedAt = new Date();
  const [disabled] = await tx.update(tenantsTable)
    .set({ status: "DISABLED", deactivatedAt })
    .where(and(eq(tenantsTable.id, input.tenantId), eq(tenantsTable.status, "ACTIVE")))
    .returning();
  if (!disabled) return current;

  await tx.update(tenantMembershipsTable)
    .set({ status: "DISABLED", updatedAt: deactivatedAt })
    .where(eq(tenantMembershipsTable.tenantId, input.tenantId));
  await tx.update(serviceCredentialsTable)
    .set({ revokedAt: deactivatedAt })
    .where(eq(serviceCredentialsTable.tenantId, input.tenantId));
  await appendAudit(tx, {
    tenantId: input.tenantId, principal: input.principal, action: "tenants:deactivate",
    targetType: "tenant", targetId: String(input.tenantId), decision: "COMMITTED",
    reasonCode: "TENANT_DEACTIVATED", correlationId: input.correlationId,
    metadata: { name: disabled.name, status: disabled.status },
  });
  return disabled;
}