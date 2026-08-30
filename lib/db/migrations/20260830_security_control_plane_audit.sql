-- Security Control Plane + immutable audit chain. Apply with a migration-owner role.
-- Production provisioning: create/login-manage the distinct soc_os_api role in the
-- deployment control plane, without a password in this migration. It must not be a
-- superuser or own either audit table. When that role already exists, this migration
-- grants only the audit permissions needed by appendAudit:
--   audit_records: SELECT, INSERT
--   audit_chain_heads: SELECT, INSERT, UPDATE
--   audit_records_id_seq: USAGE, SELECT
-- The API role must not receive UPDATE, DELETE, TRUNCATE, or TRIGGER on audit_records.
-- Production startup verifies this fail-closed.
CREATE TABLE IF NOT EXISTS control_plane_users (id serial PRIMARY KEY, clerk_user_id text NOT NULL UNIQUE, status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS tenant_memberships (id serial PRIMARY KEY, user_id integer NOT NULL REFERENCES control_plane_users(id) ON DELETE RESTRICT, tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT, role text NOT NULL CHECK (role IN ('SOC_ADMIN','ANALYST','VIEWER')), status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id, tenant_id));
CREATE INDEX IF NOT EXISTS tenant_memberships_tenant_status_idx ON tenant_memberships(tenant_id,status);
CREATE TABLE IF NOT EXISTS service_credentials (id serial PRIMARY KEY, credential_id text NOT NULL UNIQUE, credential_prefix text NOT NULL UNIQUE, tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT, principal_type text NOT NULL CHECK (principal_type IN ('SERVICE','GATEWAY')), principal_name text NOT NULL, secret_hash text NOT NULL, allowed_capabilities jsonb NOT NULL, gateway_scope text, credential_version integer NOT NULL DEFAULT 1, expires_at timestamptz, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz);
CREATE INDEX IF NOT EXISTS service_credentials_auth_lookup_idx ON service_credentials(credential_prefix,tenant_id);
CREATE TABLE IF NOT EXISTS audit_chain_heads (partition_key text PRIMARY KEY, tenant_id integer REFERENCES tenants(id) ON DELETE RESTRICT UNIQUE, sequence integer NOT NULL DEFAULT 0, current_hash text NOT NULL DEFAULT 'GENESIS', updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS audit_records (id serial PRIMARY KEY, partition_key text NOT NULL, tenant_id integer REFERENCES tenants(id) ON DELETE RESTRICT, sequence integer NOT NULL, occurred_at timestamptz NOT NULL, inserted_at timestamptz NOT NULL DEFAULT now(), principal_id text NOT NULL, principal_type text NOT NULL, action text NOT NULL, target_type text NOT NULL, target_id text NOT NULL, decision text NOT NULL, reason_code text NOT NULL, correlation_id text NOT NULL, metadata jsonb NOT NULL CHECK (octet_length(metadata::text) <= 4096), prev_hash text NOT NULL, hash text NOT NULL, external_anchor_id text, UNIQUE(partition_key,sequence), UNIQUE(partition_key,hash));
CREATE INDEX IF NOT EXISTS audit_records_tenant_occurred_idx ON audit_records(tenant_id,occurred_at); CREATE INDEX IF NOT EXISTS audit_records_correlation_idx ON audit_records(correlation_id); CREATE INDEX IF NOT EXISTS audit_records_action_decision_idx ON audit_records(action,decision); CREATE INDEX IF NOT EXISTS audit_records_principal_idx ON audit_records(principal_id); CREATE INDEX IF NOT EXISTS audit_records_target_idx ON audit_records(target_type,target_id);
CREATE OR REPLACE FUNCTION reject_audit_record_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit_records are append-only' USING ERRCODE = '55000'; END; $$;
DROP TRIGGER IF EXISTS audit_records_immutable ON audit_records;
CREATE TRIGGER audit_records_immutable BEFORE UPDATE OR DELETE ON audit_records FOR EACH ROW EXECUTE FUNCTION reject_audit_record_mutation();
REVOKE UPDATE, DELETE, TRUNCATE ON audit_records FROM PUBLIC;
REVOKE TRIGGER ON audit_records FROM PUBLIC;
REVOKE ALL ON audit_records FROM PUBLIC;
REVOKE ALL ON audit_chain_heads FROM PUBLIC;
REVOKE ALL ON SEQUENCE audit_records_id_seq FROM PUBLIC;

-- Owner-run deployment provisioning. This intentionally does not CREATE ROLE or
-- assign credentials: managed deployment control planes must provision soc_os_api
-- separately. Re-running it resets this role's direct audit-object grants to the
-- least-privilege contract. It refuses an unsafe owner or superuser role rather
-- than silently making a production connection appear safe.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'soc_os_api') THEN
    IF (SELECT rolsuper FROM pg_roles WHERE rolname = 'soc_os_api') THEN
      RAISE EXCEPTION 'soc_os_api must not be a superuser';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_roles r ON r.oid = c.relowner
      WHERE n.nspname = 'public'
        AND c.relname IN ('audit_records', 'audit_chain_heads')
        AND r.rolname = 'soc_os_api'
    ) THEN
      RAISE EXCEPTION 'soc_os_api must not own audit tables';
    END IF;

    REVOKE ALL PRIVILEGES ON audit_records, audit_chain_heads FROM soc_os_api;
    REVOKE TRIGGER ON audit_records FROM soc_os_api;
    REVOKE ALL PRIVILEGES ON SEQUENCE audit_records_id_seq FROM soc_os_api;
    GRANT SELECT, INSERT ON audit_records TO soc_os_api;
    GRANT SELECT, INSERT, UPDATE ON audit_chain_heads TO soc_os_api;
    GRANT USAGE, SELECT ON SEQUENCE audit_records_id_seq TO soc_os_api;
  END IF;
END $$;

-- Development-only convenience grant for the migration session. It is not a
-- production role-provisioning mechanism and does not establish production safety.
GRANT SELECT, INSERT ON audit_records TO CURRENT_USER;
GRANT SELECT, INSERT, UPDATE ON audit_chain_heads TO CURRENT_USER;
GRANT USAGE, SELECT ON SEQUENCE audit_records_id_seq TO CURRENT_USER;