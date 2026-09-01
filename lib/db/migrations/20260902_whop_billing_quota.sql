-- Whop remains the source of truth. These tables only bind server-created
-- checkout configurations and short-lived free-test reservations to SOC users.
CREATE TABLE IF NOT EXISTS whop_checkout_sessions (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES control_plane_users(id) ON DELETE RESTRICT,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  checkout_correlation_id text NOT NULL,
  provider_plan_id text NOT NULL,
  provider_checkout_id text NOT NULL,
  provider_payment_id text,
  purchase_url text NOT NULL,
  status text NOT NULL DEFAULT 'CREATED',
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whop_checkout_sessions_status_check
    CHECK (status IN ('CREATED', 'VERIFIED', 'EXPIRED', 'FAILED'))
);

ALTER TABLE whop_checkout_sessions
  ADD COLUMN IF NOT EXISTS checkout_correlation_id text;
ALTER TABLE whop_checkout_sessions
  ADD COLUMN IF NOT EXISTS provider_plan_id text;
UPDATE whop_checkout_sessions
  SET checkout_correlation_id = md5(random()::text || clock_timestamp()::text || id::text)
  WHERE checkout_correlation_id IS NULL;
UPDATE whop_checkout_sessions
  SET provider_plan_id = 'plan_nOqioR0u71s4Q'
  WHERE provider_plan_id IS NULL;
ALTER TABLE whop_checkout_sessions
  ALTER COLUMN checkout_correlation_id SET NOT NULL;
ALTER TABLE whop_checkout_sessions
  ALTER COLUMN provider_plan_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS whop_checkout_sessions_correlation_uidx
  ON whop_checkout_sessions(checkout_correlation_id);
CREATE UNIQUE INDEX IF NOT EXISTS whop_checkout_sessions_checkout_uidx
  ON whop_checkout_sessions(provider_checkout_id);
CREATE UNIQUE INDEX IF NOT EXISTS whop_checkout_sessions_payment_uidx
  ON whop_checkout_sessions(provider_payment_id);
CREATE INDEX IF NOT EXISTS whop_checkout_sessions_user_tenant_idx
  ON whop_checkout_sessions(user_id, tenant_id);

CREATE TABLE IF NOT EXISTS security_test_usage (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES control_plane_users(id) ON DELETE RESTRICT,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  test_type text NOT NULL,
  status text NOT NULL DEFAULT 'RESERVED',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  released_at timestamptz,
  CONSTRAINT security_test_usage_type_check
    CHECK (test_type IN ('SELF_TEST', 'SIMULATION', 'LOCKFILE_SCAN', 'VOICE_VIRUS_TEST', 'VOICE_DEFENSE_TEST')),
  CONSTRAINT security_test_usage_status_check
    CHECK (status IN ('RESERVED', 'COMPLETED', 'RELEASED'))
);

-- Serves quota counts for a principal/tenant and bounded cleanup of abandoned
-- reservations. Foreign keys are intentionally indexed by these composite
-- workload indexes rather than individual redundant indexes.
CREATE INDEX IF NOT EXISTS security_test_usage_user_tenant_status_idx
  ON security_test_usage(user_id, tenant_id, status);
CREATE INDEX IF NOT EXISTS security_test_usage_reservation_idx
  ON security_test_usage(status, started_at);