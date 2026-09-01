import type { Request, Response } from "express";
import { completeSecurityTestQuotaReservation, releaseSecurityTestQuotaReservation, reserveSecurityTestQuota, type SecurityTestType } from "./security-test-quota";
import { getBillingStatus } from "../routes/billing";
import { singleTenantScope } from "../middlewares/principal";

export type SecurityTestAccess = { usageId?: number; complete: () => Promise<void>; release: () => Promise<void> };

/** Enforces billing without changing membership or control-plane capabilities. */
export async function requireSecurityTestAccess(req: Request, res: Response, testType: SecurityTestType): Promise<SecurityTestAccess | null> {
  const tenantId = singleTenantScope(req);
  const userId = req.principal?.principalType === "USER" ? Number(req.principal.principalId) : NaN;
  if (!Number.isSafeInteger(userId) || tenantId === null) {
    res.status(403).json({ error: "TENANT_SCOPE_MISMATCH", code: "TENANT_SCOPE_MISMATCH" });
    return null;
  }
  try {
    const billing = await getBillingStatus(userId, tenantId);
    const reservation = await reserveSecurityTestQuota({ userId, tenantId, testType, paidAccess: billing.paidAccess, freeLimit: billing.freeLimit });
    if (!reservation.decision.allowed) {
      res.status(402).json({
        error: "Payment required to run more security tests",
        code: "PAYMENT_REQUIRED",
        freeLimit: billing.freeLimit,
        freeUsed: reservation.decision.freeUsed,
        usage: reservation.decision.freeUsed,
        freeRemaining: 0,
        checkoutPath: "/billing",
      });
      return null;
    }
    let settled = false;
    const usageId = reservation.usageId;
    const release = async () => {
      if (settled || !usageId) return;
      settled = true;
      await releaseSecurityTestQuotaReservation(usageId);
    };
    const complete = async () => {
      if (settled || !usageId) return;
      await completeSecurityTestQuotaReservation(usageId);
      settled = true;
    };
    res.once("finish", () => {
      if (res.statusCode >= 400) void release();
    });
    return {
      usageId,
      complete,
      release,
    };
  } catch {
    res.status(502).json({ error: "BILLING_PROVIDER_UNAVAILABLE", code: "BILLING_PROVIDER_UNAVAILABLE" });
    return null;
  }
}