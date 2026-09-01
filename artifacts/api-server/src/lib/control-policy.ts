export const CAPABILITIES = [
  "events:read", "events:ingest", "events:status:update", "traffic:read", "agent:observe",
  "execution:read", "execution:submit", "execution:retry", "execution:recover", "execution:dlq:operate",
  "quarantine:read", "quarantine:approve", "self_healing:preview", "self_healing:apply", "audit:read", "audit:verify",
  "rules:read", "rules:write", "tenants:read", "tenants:write", "dashboard:read",
  "virus:read", "virus:write", "testing:run", "voice:use", "strategy:global:read",
] as const;
export type Capability = typeof CAPABILITIES[number];
export type PrincipalType = "USER" | "SERVICE" | "GATEWAY";
export type Principal = { principalId: string; principalType: PrincipalType; tenantIds: number[]; roles: string[]; capabilities: Capability[]; authMethod: "CLERK" | "SCOPED_CREDENTIAL"; credentialVersion: number; correlationId: string; gatewayScope?: string | null };
export type PolicyDecision = { allowed: boolean; decisionId: string; subject: Pick<Principal, "principalId" | "principalType">; tenantId: number | null; action: Capability; target: { type: string; id: string }; reasonCode: string; expiresAt: string | null; requiredApproval: boolean };

const ROLE_CAPABILITIES: Record<string, Capability[]> = {
  SOC_ADMIN: [...CAPABILITIES],
  ANALYST: ["events:read", "events:status:update", "traffic:read", "agent:observe", "execution:read", "execution:submit", "execution:retry", "execution:recover", "execution:dlq:operate", "quarantine:read", "quarantine:approve", "self_healing:preview", "self_healing:apply", "audit:read", "audit:verify", "rules:read", "rules:write", "tenants:read", "dashboard:read", "virus:read", "virus:write", "testing:run", "voice:use"],
  VIEWER: ["events:read", "traffic:read", "execution:read", "quarantine:read", "self_healing:preview", "audit:read", "rules:read", "tenants:read", "dashboard:read", "virus:read"],
};
export function capabilitiesForRoles(roles: string[]): Capability[] { return [...new Set(roles.flatMap((role) => ROLE_CAPABILITIES[role] ?? []))]; }
export function authorize(principal: Principal | undefined, action: Capability, target: { type: string; id: string }, tenantId: number | null): PolicyDecision {
  const decisionId = crypto.randomUUID();
  if (!principal) return { allowed: false, decisionId, subject: { principalId: "anonymous", principalType: "USER" }, tenantId, action, target, reasonCode: "AUTHENTICATION_REQUIRED", expiresAt: null, requiredApproval: false };
  if (tenantId !== null && !principal.tenantIds.includes(tenantId)) return { allowed: false, decisionId, subject: principal, tenantId, action, target, reasonCode: "TENANT_SCOPE_MISMATCH", expiresAt: null, requiredApproval: false };
  const allowed = principal.capabilities.includes(action);
  return { allowed, decisionId, subject: principal, tenantId, action, target, reasonCode: allowed ? "ALLOWED" : "CAPABILITY_DENIED", expiresAt: null, requiredApproval: false };
}