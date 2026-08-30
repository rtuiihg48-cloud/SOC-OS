import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@workspace/db/schema";
import { pool } from "@workspace/db";
import type { PoolClient } from "@workspace/db";
import { appendAudit, assessAuditReadiness, verifyAudit } from "../lib/audit";
import type { Principal } from "../lib/control-policy";
import { deactivateTenant } from "../lib/tenant-lifecycle";

const principal: Principal = { principalId: "db-test", principalType: "SERVICE", tenantIds: [], roles: [], capabilities: ["audit:read"], authMethod: "SCOPED_CREDENTIAL", credentialVersion: 1, correlationId: "db-test-correlation" };
let client: PoolClient;
let tx: any;

beforeAll(async () => {
  client = await pool.connect();
  await client.query("BEGIN");
  // Shadow production names with transaction-local tables. This exercises the
  // PostgreSQL locking SQL without applying or leaving migration data behind.
  await client.query(`CREATE TEMP TABLE audit_chain_heads (
    partition_key text PRIMARY KEY, tenant_id integer UNIQUE, sequence integer NOT NULL DEFAULT 0,
    current_hash text NOT NULL DEFAULT 'GENESIS', updated_at timestamptz NOT NULL DEFAULT now()
  ) ON COMMIT DROP`);
  await client.query(`CREATE TEMP TABLE audit_records (
    id serial PRIMARY KEY, partition_key text NOT NULL, tenant_id integer, sequence integer NOT NULL,
    occurred_at timestamptz NOT NULL, inserted_at timestamptz NOT NULL DEFAULT now(),
    principal_id text NOT NULL, principal_type text NOT NULL, action text NOT NULL,
    target_type text NOT NULL, target_id text NOT NULL, decision text NOT NULL,
    reason_code text NOT NULL, correlation_id text NOT NULL, metadata jsonb NOT NULL,
    prev_hash text NOT NULL, hash text NOT NULL, external_anchor_id text,
    UNIQUE(partition_key, sequence), UNIQUE(partition_key, hash)
  ) ON COMMIT DROP`);
  await client.query(`CREATE TEMP TABLE tenants (
    id serial PRIMARY KEY, name text NOT NULL, api_key text NOT NULL, plan text NOT NULL DEFAULT 'starter',
    status text NOT NULL DEFAULT 'ACTIVE', deactivated_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
  ) ON COMMIT DROP`);
  await client.query(`CREATE TEMP TABLE tenant_memberships (
    id serial PRIMARY KEY, user_id integer NOT NULL, tenant_id integer NOT NULL, role text NOT NULL,
    status text NOT NULL DEFAULT 'ACTIVE', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
  ) ON COMMIT DROP`);
  await client.query(`CREATE TEMP TABLE service_credentials (
    id serial PRIMARY KEY, credential_id text NOT NULL, credential_prefix text NOT NULL, tenant_id integer NOT NULL,
    principal_type text NOT NULL, principal_name text NOT NULL, secret_hash text NOT NULL,
    allowed_capabilities jsonb NOT NULL, gateway_scope text, credential_version integer NOT NULL DEFAULT 1,
    expires_at timestamptz, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz
  ) ON COMMIT DROP`);
  tx = drizzle(client, { schema });
});
afterAll(async () => { await client.query("ROLLBACK"); client.release(); });

describe("audit chain database integration", () => {
  it("rejects a role contract missing chain-head UPDATE", () => {
    const role = {
      audit_records_exists: true, audit_chain_heads_exists: true, immutable_trigger_exists: true,
      role_is_superuser: false, role_owns_audit_records: false, role_owns_audit_chain_heads: false,
      can_select_audit_records: true, can_insert_audit_records: true,
      can_select_audit_chain_heads: true, can_insert_audit_chain_heads: true, can_update_audit_chain_heads: false,
      can_use_audit_records_sequence: true, can_select_audit_records_sequence: true,
      can_update_audit_records: false, can_delete_audit_records: false, can_truncate_audit_records: false, can_trigger_audit_records: false,
    };
    expect(assessAuditReadiness(role)).toMatchObject({
      ready: false,
      failures: expect.arrayContaining(["API database role cannot UPDATE audit_chain_heads"]),
    });
  });
  it("rejects a role contract with effective audit-record TRIGGER privilege", () => {
    const role = {
      audit_records_exists: true, audit_chain_heads_exists: true, immutable_trigger_exists: true,
      role_is_superuser: false, role_owns_audit_records: false, role_owns_audit_chain_heads: false,
      can_select_audit_records: true, can_insert_audit_records: true,
      can_select_audit_chain_heads: true, can_insert_audit_chain_heads: true, can_update_audit_chain_heads: true,
      can_use_audit_records_sequence: true, can_select_audit_records_sequence: true,
      can_update_audit_records: false, can_delete_audit_records: false, can_truncate_audit_records: false, can_trigger_audit_records: true,
    };
    expect(assessAuditReadiness(role)).toMatchObject({
      ready: false,
      failures: expect.arrayContaining(["API database role can TRIGGER audit_records"]),
    });
  });
  it("sequences a tenant partition and verifies its chain without persistent test data", async () => {
    const tenantId = 999_001;
    principal.tenantIds = [tenantId];
    await appendAudit(tx, { tenantId, principal, action: "events:ingest", targetType: "event", targetId: "1", decision: "COMMITTED", reasonCode: "TEST", correlationId: "one", occurredAt: new Date("2026-01-01T00:00:00Z") });
    await appendAudit(tx, { tenantId, principal, action: "events:status:update", targetType: "event", targetId: "1", decision: "COMMITTED", reasonCode: "TEST", correlationId: "two", occurredAt: new Date("2026-01-02T00:00:00Z") });
    expect(await verifyAudit(tx, tenantId)).toMatchObject({ valid: true, checked: 2 });
    expect(await verifyAudit(tx, tenantId, new Date("2026-01-02T00:00:00Z"))).toMatchObject({ valid: true, checked: 1 });
  });
  it("partitions system evidence separately", async () => {
    await appendAudit(tx, { tenantId: null, principal, action: "audit:verify", targetType: "audit", targetId: "system", decision: "COMMITTED", reasonCode: "TEST", correlationId: "system" });
    expect(await verifyAudit(tx, null)).toMatchObject({ valid: true, checked: 1 });
  });
  it("uses the immediate predecessor when verifying a range", async () => {
    const tenantId = 999_002;
    principal.tenantIds = [tenantId];
    await appendAudit(tx, { tenantId, principal, action: "one", targetType: "event", targetId: "1", decision: "COMMITTED", reasonCode: "TEST", correlationId: "one", occurredAt: new Date("2026-01-01T00:00:00Z") });
    await appendAudit(tx, { tenantId, principal, action: "two", targetType: "event", targetId: "2", decision: "COMMITTED", reasonCode: "TEST", correlationId: "two", occurredAt: new Date("2026-01-02T00:00:00Z") });
    expect(await verifyAudit(tx, tenantId, new Date("2026-01-02T00:00:00Z"))).toMatchObject({ valid: true, checked: 1 });
  });
  it("detects a mismatched chain head and a truncated tail", async () => {
    const tenantId = 999_003;
    principal.tenantIds = [tenantId];
    await appendAudit(tx, { tenantId, principal, action: "one", targetType: "event", targetId: "1", decision: "COMMITTED", reasonCode: "TEST", correlationId: "one" });
    await client.query("UPDATE audit_chain_heads SET current_hash = 'CORRUPT' WHERE partition_key = $1", [`tenant:${tenantId}`]);
    expect(await verifyAudit(tx, tenantId)).toMatchObject({ valid: false, errorCode: "HEAD_MISMATCH" });

    const truncatedTenant = 999_004;
    principal.tenantIds = [truncatedTenant];
    await appendAudit(tx, { tenantId: truncatedTenant, principal, action: "one", targetType: "event", targetId: "1", decision: "COMMITTED", reasonCode: "TEST", correlationId: "one" });
    await appendAudit(tx, { tenantId: truncatedTenant, principal, action: "two", targetType: "event", targetId: "2", decision: "COMMITTED", reasonCode: "TEST", correlationId: "two" });
    await client.query("DELETE FROM audit_records WHERE partition_key = $1 AND sequence = 2", [`tenant:${truncatedTenant}`]);
    expect(await verifyAudit(tx, truncatedTenant)).toMatchObject({ valid: false, errorCode: "HEAD_MISMATCH" });
  });
  it("deactivates a tenant with audit history without deleting lifecycle evidence", async () => {
    const tenantId = 999_006;
    principal.tenantIds = [tenantId];
    await client.query("INSERT INTO tenants(id,name,api_key) VALUES ($1,'Lifecycle tenant','test-key')", [tenantId]);
    await client.query("INSERT INTO tenant_memberships(user_id,tenant_id,role) VALUES (1,$1,'SOC_ADMIN')", [tenantId]);
    await client.query(`INSERT INTO service_credentials(credential_id,credential_prefix,tenant_id,principal_type,principal_name,secret_hash,allowed_capabilities)
      VALUES ('credential','prefix',$1,'SERVICE','test','hash','[]')`, [tenantId]);
    await appendAudit(tx, { tenantId, principal, action: "tenant:history", targetType: "tenant", targetId: String(tenantId), decision: "COMMITTED", reasonCode: "TEST", correlationId: "history" });

    const disabled = await deactivateTenant(tx, {
      tenantId, principal, correlationId: "deactivate",
    });
    expect(disabled).toMatchObject({ id: tenantId, status: "DISABLED" });
    expect((await client.query("SELECT status FROM tenants WHERE id=$1", [tenantId])).rows[0]?.status).toBe("DISABLED");
    expect((await client.query("SELECT status FROM tenant_memberships WHERE tenant_id=$1", [tenantId])).rows[0]?.status).toBe("DISABLED");
    expect((await client.query("SELECT revoked_at FROM service_credentials WHERE tenant_id=$1", [tenantId])).rows[0]?.revoked_at).toBeInstanceOf(Date);
    expect(await verifyAudit(tx, tenantId)).toMatchObject({ valid: true, checked: 2 });

    await deactivateTenant(tx, {
      tenantId, principal, correlationId: "deactivate-again",
    });
    expect(await verifyAudit(tx, tenantId)).toMatchObject({ valid: true, checked: 2 });
  });
  it("rolls back protected writes when required audit evidence fails", async () => {
    const tenantId = 999_005;
    await client.query("ALTER TABLE audit_records ADD CONSTRAINT audit_failure_test CHECK (false) NOT VALID");
    await expect(tx.transaction(async (protectedTx: any) => {
      await appendAudit(protectedTx, { tenantId, principal, action: "protected:write", targetType: "event", targetId: "1", decision: "COMMITTED", reasonCode: "TEST", correlationId: "failure" });
    })).rejects.toThrow();
    const head = await client.query("SELECT * FROM audit_chain_heads WHERE partition_key = $1", [`tenant:${tenantId}`]);
    expect(head.rowCount).toBe(0);
  });
});