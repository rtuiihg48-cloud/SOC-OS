import { Router, type NextFunction, type Request, type Response } from "express";
import { and, count, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, securityTestUsageTable, whopCheckoutSessionsTable } from "@workspace/db";
import { freeSecurityTestLimit } from "../lib/security-test-quota";
import { getWhopClient } from "../lib/whopClient";
import { buildBillingReturnUrl } from "../lib/billing-url";
import { singleTenantScope } from "../middlewares/principal";

const router = Router();
type BillingInterval = "month" | "year";

function requireSameOrigin(req: Request, res: Response, next: NextFunction): void {
  const origin = req.get("origin");
  const forwardedHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || req.get("host");
  if (!origin || !host) {
    res.status(403).json({ error: "TRUSTED_ORIGIN_REQUIRED", code: "TRUSTED_ORIGIN_REQUIRED" });
    return;
  }
  try {
    if (new URL(origin).host !== host) {
      res.status(403).json({ error: "TRUSTED_ORIGIN_REQUIRED", code: "TRUSTED_ORIGIN_REQUIRED" });
      return;
    }
  } catch {
    res.status(403).json({ error: "TRUSTED_ORIGIN_REQUIRED", code: "TRUSTED_ORIGIN_REQUIRED" });
    return;
  }
  next();
}

function scope(req: Parameters<typeof singleTenantScope>[0]) {
  const tenantId = singleTenantScope(req);
  const userId = req.principal?.principalType === "USER" ? Number(req.principal.principalId) : NaN;
  return Number.isSafeInteger(userId) && tenantId !== null ? { userId, tenantId } : null;
}

function configuration() {
  const companyId = process.env.WHOP_COMPANY_ID;
  const monthlyPlanId = process.env.WHOP_MONTHLY_PLAN_ID ?? process.env.WHOP_PLAN_ID;
  const annualPlanId = process.env.WHOP_ANNUAL_PLAN_ID;
  if (!companyId || !monthlyPlanId || !annualPlanId) throw new Error("Whop billing configuration is incomplete");
  return {
    companyId,
    plans: {
      month: { id: monthlyPlanId, price: 29, currency: "USD", interval: "month" as const },
      year: { id: annualPlanId, price: 290, currency: "USD", interval: "year" as const },
    },
  };
}

function returnUrl(req: Parameters<typeof singleTenantScope>[0], correlationId: string): string {
  const configured = process.env.APP_URL;
  const basePath = process.env.SOC_DASHBOARD_BASE_PATH ?? "/soc-dashboard";
  if (configured) return buildBillingReturnUrl(configured, basePath, correlationId);
  const host = req.get("host");
  if (!host || !/^[a-zA-Z0-9.-]+(?::\d{1,5})?$/.test(host)) throw new Error("APP_URL must be configured for billing redirects");
  return buildBillingReturnUrl(`${req.protocol}://${host}`, basePath, correlationId);
}

async function paymentAccess(checkoutId: string, userId: number, tenantId: number) {
  const [mapping] = await db.select().from(whopCheckoutSessionsTable).where(and(
    eq(whopCheckoutSessionsTable.providerCheckoutId, checkoutId),
    eq(whopCheckoutSessionsTable.userId, userId),
    eq(whopCheckoutSessionsTable.tenantId, tenantId),
  ));
  if (!mapping) return { paidAccess: false, manageUrl: null, mapping: null, paymentId: null };

  const { companyId, plans } = configuration();
  const allowedPlanIds = new Set([plans.month.id, plans.year.id]);
  const planId = mapping.providerPlanId;
  if (!allowedPlanIds.has(planId)) return { paidAccess: false, manageUrl: null, mapping, paymentId: null };
  const whop = await getWhopClient();
  const configurationResult = await whop.checkoutConfigurations.retrieve(checkoutId);
  const metadata = configurationResult.metadata ?? {};
  if (
    configurationResult.plan?.id !== planId ||
    metadata.soc_user_id !== String(userId) ||
    metadata.soc_tenant_id !== String(tenantId) ||
    metadata.soc_checkout_correlation !== mapping.checkoutCorrelationId
  ) {
    return { paidAccess: false, manageUrl: null, mapping, paymentId: null };
  }
  const matchesPayment = (row: {
    status: string | null;
    membership: { id: string; status: string } | null;
    company: { id: string } | null;
    plan: { id: string } | null;
    metadata: Record<string, unknown> | null;
  }) => row.status === "paid" &&
    row.membership?.status === "active" &&
    row.company?.id === companyId &&
    row.plan?.id === planId &&
    row.metadata?.soc_user_id === String(userId) &&
    row.metadata?.soc_tenant_id === String(tenantId) &&
    row.metadata?.soc_checkout_correlation === mapping.checkoutCorrelationId;

  let payment = mapping.providerPaymentId
    ? await whop.payments.retrieve(mapping.providerPaymentId)
    : null;
  if (payment && !matchesPayment(payment)) payment = null;
  if (!payment) {
    for await (const candidate of whop.payments.list({ company_id: companyId, first: 100 })) {
      if (matchesPayment(candidate)) {
        payment = candidate;
        break;
      }
    }
  }
  if (!payment?.membership) return { paidAccess: false, manageUrl: null, mapping, paymentId: null };

  const membership = await whop.memberships.retrieve(payment.membership.id);
  const activeMembership =
    membership.status === "active" &&
    membership.plan?.id === planId &&
    membership.company?.id === companyId &&
    membership.metadata?.soc_user_id === String(userId) &&
    membership.metadata?.soc_tenant_id === String(tenantId) &&
    membership.metadata?.soc_checkout_correlation === mapping.checkoutCorrelationId;
  return { paidAccess: activeMembership, manageUrl: activeMembership ? membership.manage_url : null, mapping, paymentId: payment.id };
}

export async function getBillingStatus(userId: number, tenantId: number) {
  const [usage] = await db.select({ used: count() }).from(securityTestUsageTable).where(and(
    eq(securityTestUsageTable.userId, userId), eq(securityTestUsageTable.tenantId, tenantId),
    inArray(securityTestUsageTable.status, ["RESERVED", "COMPLETED"]),
  ));
  const freeLimit = freeSecurityTestLimit();
  const sessions = await db.select().from(whopCheckoutSessionsTable).where(and(
    eq(whopCheckoutSessionsTable.userId, userId), eq(whopCheckoutSessionsTable.tenantId, tenantId),
  ));
  let paidAccess = false;
  let manageUrl: string | null = null;
  // Check Whop live for every previously verified mapping. Local verification
  // is only a correlation marker and never makes access durable by itself.
  for (const session of sessions.filter((row) => row.status === "VERIFIED")) {
    const access = await paymentAccess(session.providerCheckoutId, userId, tenantId);
    if (access.paidAccess) { paidAccess = true; manageUrl = access.manageUrl; break; }
  }
  const freeUsed = Math.min(usage?.used ?? 0, freeLimit);
  const { plans } = configuration();
  return {
    plans: [
      { price: plans.month.price, currency: plans.month.currency, interval: plans.month.interval },
      { price: plans.year.price, currency: plans.year.currency, interval: plans.year.interval, savings: 58 },
    ],
    freeLimit,
    freeUsed,
    freeRemaining: Math.max(freeLimit - freeUsed, 0),
    paidAccess,
    manageUrl,
  };
}

router.get("/billing/status", async (req, res) => {
  const principalScope = scope(req);
  if (!principalScope) { res.status(req.principal ? 403 : 401).json({ error: "AUTHENTICATION_REQUIRED", code: "AUTHENTICATION_REQUIRED" }); return; }
  try { res.json(await getBillingStatus(principalScope.userId, principalScope.tenantId)); }
  catch { res.status(502).json({ error: "BILLING_PROVIDER_UNAVAILABLE", code: "BILLING_PROVIDER_UNAVAILABLE" }); }
});

router.post("/billing/checkout", requireSameOrigin, async (req, res) => {
  const principalScope = scope(req);
  if (!principalScope) { res.status(req.principal ? 403 : 401).json({ error: "AUTHENTICATION_REQUIRED", code: "AUTHENTICATION_REQUIRED" }); return; }
  const interval = req.body?.interval;
  if (interval !== "month" && interval !== "year") {
    res.status(400).json({ error: "Invalid billing interval", code: "INVALID_BILLING_INTERVAL" });
    return;
  }
  try {
    const { plans } = configuration();
    const selectedPlan = plans[interval as BillingInterval];
    const whop = await getWhopClient();
    const checkoutCorrelationId = randomUUID();
    const checkout = await whop.checkoutConfigurations.create({
      plan_id: selectedPlan.id,
      redirect_url: returnUrl(req, checkoutCorrelationId),
      metadata: {
        soc_user_id: String(principalScope.userId),
        soc_tenant_id: String(principalScope.tenantId),
        soc_checkout_correlation: checkoutCorrelationId,
        soc_billing_interval: interval,
      },
    });
    await db.insert(whopCheckoutSessionsTable).values({
      userId: principalScope.userId, tenantId: principalScope.tenantId,
      checkoutCorrelationId, providerPlanId: selectedPlan.id, providerCheckoutId: checkout.id,
      purchaseUrl: checkout.purchase_url, status: "CREATED",
    });
    res.status(201).json({ checkoutId: checkout.id, purchase_url: checkout.purchase_url });
  } catch { res.status(502).json({ error: "CHECKOUT_UNAVAILABLE", code: "CHECKOUT_UNAVAILABLE" }); }
});

router.post("/billing/verify", requireSameOrigin, async (req, res) => {
  const principalScope = scope(req);
  const checkoutCorrelation = typeof req.body?.checkoutCorrelation === "string" ? req.body.checkoutCorrelation : null;
  if (!principalScope) { res.status(req.principal ? 403 : 401).json({ error: "AUTHENTICATION_REQUIRED", code: "AUTHENTICATION_REQUIRED" }); return; }
  if (!checkoutCorrelation || !/^[0-9a-f-]{36}$/i.test(checkoutCorrelation)) { res.status(400).json({ error: "Invalid checkout correlation", code: "INVALID_CHECKOUT_CORRELATION" }); return; }
  try {
    const [mapping] = await db.select().from(whopCheckoutSessionsTable).where(and(
      eq(whopCheckoutSessionsTable.checkoutCorrelationId, checkoutCorrelation),
      eq(whopCheckoutSessionsTable.userId, principalScope.userId),
      eq(whopCheckoutSessionsTable.tenantId, principalScope.tenantId),
    ));
    if (!mapping) { res.status(404).json({ error: "CHECKOUT_NOT_FOUND", code: "CHECKOUT_NOT_FOUND" }); return; }
    const access = await paymentAccess(mapping.providerCheckoutId, principalScope.userId, principalScope.tenantId);
    if (!access.paidAccess || !access.paymentId) { res.status(409).json({ paidAccess: false, code: "PAYMENT_NOT_CONFIRMED" }); return; }
    await db.update(whopCheckoutSessionsTable).set({ status: "VERIFIED", providerPaymentId: access.paymentId, verifiedAt: new Date() }).where(eq(whopCheckoutSessionsTable.id, access.mapping.id));
    res.json({ paidAccess: true, manageUrl: access.manageUrl });
  } catch { res.status(502).json({ error: "BILLING_PROVIDER_UNAVAILABLE", code: "BILLING_PROVIDER_UNAVAILABLE" }); }
});

export { paymentAccess };
export default router;