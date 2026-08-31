import type { NextFunction, Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { db, controlPlaneUsersTable, serviceCredentialsTable, tenantMembershipsTable } from "@workspace/db";
import { authorize, capabilitiesForRoles, type Principal } from "../lib/control-policy";
import { createHash, timingSafeEqual } from "crypto";

declare global { namespace Express { interface Request { principal?: Principal; } } }
const secretHash = (value: string) => createHash("sha256").update(value).digest("hex");

export async function attachPrincipal(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const supplied = req.header("x-service-credential");
    if (supplied) {
      const [prefix, secret] = supplied.split(".", 2);
      if (!prefix || !secret) { next(); return; }
      const [credential] = await db.select().from(serviceCredentialsTable).where(and(eq(serviceCredentialsTable.credentialPrefix, prefix), isNull(serviceCredentialsTable.revokedAt), or(isNull(serviceCredentialsTable.expiresAt), gt(serviceCredentialsTable.expiresAt, new Date()))));
      if (credential && timingSafeEqual(Buffer.from(credential.secretHash), Buffer.from(secretHash(secret)))) {
        req.principal = { principalId: credential.credentialId, principalType: credential.principalType as "SERVICE" | "GATEWAY", tenantIds: [credential.tenantId], roles: [], capabilities: credential.allowedCapabilities as Principal["capabilities"], authMethod: "SCOPED_CREDENTIAL", credentialVersion: credential.credentialVersion, correlationId: String(req.id), gatewayScope: credential.gatewayScope };
      }
      next(); return;
    }
    const userId = getAuth(req).userId;
    if (!userId) { next(); return; }
    // A verified Clerk session is provisioned locally on first use, but receives
    // no membership, role, or capability. Tenant access remains operator-managed.
    await db.insert(controlPlaneUsersTable).values({ clerkUserId: userId }).onConflictDoNothing();
    const [user] = await db.select().from(controlPlaneUsersTable).where(eq(controlPlaneUsersTable.clerkUserId, userId));
    if (!user || user.status !== "ACTIVE") { next(); return; }
    const memberships = await db.select().from(tenantMembershipsTable).where(and(eq(tenantMembershipsTable.userId, user.id), eq(tenantMembershipsTable.status, "ACTIVE")));
    const roles = memberships.map((membership) => membership.role);
    req.principal = { principalId: String(user.id), principalType: "USER", tenantIds: memberships.map((membership) => membership.tenantId), roles, capabilities: capabilitiesForRoles(roles), authMethod: "CLERK", credentialVersion: 1, correlationId: String(req.id) };
    next();
  } catch (error) { next(error); }
}

export function requireCapability(action: Principal["capabilities"][number], tenant: (req: Request) => number | null) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const decision = authorize(req.principal, action, { type: "route", id: req.path }, tenant(req));
    if (!decision.allowed) { res.status(decision.reasonCode === "AUTHENTICATION_REQUIRED" ? 401 : 403).json({ error: decision.reasonCode, code: decision.reasonCode, decisionId: decision.decisionId }); return; }
    next();
  };
}

/** A request cannot choose a tenant. Multi-tenant operators must target a server-loaded resource. */
export function singleTenantScope(req: Request): number | null {
  return req.principal?.tenantIds.length === 1 ? req.principal.tenantIds[0] ?? null : null;
}