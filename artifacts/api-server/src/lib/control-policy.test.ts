import { describe, expect, it } from "vitest";
import { auditHash, canonicalAuditPayload, sanitizeMetadata } from "./audit";
import { authorize, capabilitiesForRoles, type Principal } from "./control-policy";

const admin: Principal = { principalId: "1", principalType: "USER", tenantIds: [7], roles: ["SOC_ADMIN"], capabilities: capabilitiesForRoles(["SOC_ADMIN"]), authMethod: "CLERK", credentialVersion: 1, correlationId: "test" };
const record = { partitionKey: "tenant:7", sequence: 1, tenantId: 7, occurredAt: "2026-08-30T00:00:00.000Z", principalId: "1", principalType: "USER", action: "events:ingest", targetType: "event", targetId: "1", decision: "COMMITTED", reasonCode: "OK", correlationId: "test", metadata: {}, prevHash: "GENESIS" };
describe("security control plane", () => {
  it("keeps authorization typed and tenant scoped", () => {
    expect(authorize(admin, "events:ingest", { type: "event", id: "1" }, 7).allowed).toBe(true);
    expect(authorize(admin, "events:ingest", { type: "event", id: "1" }, 8).reasonCode).toBe("TENANT_SCOPE_MISMATCH");
  });
  it("creates deterministic canonical evidence and redacts secrets", () => {
    expect(canonicalAuditPayload(record)).toBe(canonicalAuditPayload({ ...record }));
    expect(auditHash(record)).not.toBe(auditHash({ ...record, decision: "FAILED" }));
    expect(sanitizeMetadata({ token: "never", safe: "yes" })).toEqual({ safe: "yes" });
  });
  it("canonicalizes nested metadata regardless of object insertion order", () => {
    const first = { ...record, metadata: { z: [{ b: 2, a: 1 }], a: { y: true, x: false } } };
    const second = { ...record, metadata: { a: { x: false, y: true }, z: [{ a: 1, b: 2 }] } };
    expect(canonicalAuditPayload(first)).toBe(canonicalAuditPayload(second));
    expect(auditHash(first)).toBe(auditHash(second));
    expect(() => sanitizeMetadata({ value: undefined })).toThrow("JSON-compatible");
  });
});