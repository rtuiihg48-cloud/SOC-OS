-- Tenant-scoped, metadata-only Node Gateway traffic evidence.
-- Packet payloads, request bodies, decrypted content, and raw captures are not
-- represented by this table. Traffic observations are append-only evidence.
CREATE TABLE IF NOT EXISTS traffic_observations (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  gateway_id text NOT NULL,
  observation_id text NOT NULL,
  observation_type text NOT NULL DEFAULT 'FLOW',
  observed_at timestamptz NOT NULL,
  protocol text NOT NULL DEFAULT 'UNKNOWN',
  direction text NOT NULL DEFAULT 'UNKNOWN',
  source_asset text,
  destination_asset text,
  source_port integer,
  destination_port integer,
  bytes_out integer NOT NULL DEFAULT 0,
  bytes_in integer NOT NULL DEFAULT 0,
  packets integer NOT NULL DEFAULT 0,
  duration_ms integer NOT NULL DEFAULT 0,
  dns_query_name text,
  tls_server_name text,
  http_host text,
  heartbeat_status text,
  heartbeat_latency_ms integer,
  is_synthetic boolean NOT NULL DEFAULT false,
  risk_score integer NOT NULL DEFAULT 0,
  severity text NOT NULL DEFAULT 'LOW',
  signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommended_action text NOT NULL DEFAULT 'ALLOW',
  analysis_version text NOT NULL DEFAULT 'traffic-v1',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT traffic_observations_type_check CHECK (observation_type IN ('FLOW','HEARTBEAT')),
  CONSTRAINT traffic_observations_direction_check CHECK (direction IN ('INBOUND','OUTBOUND','INTERNAL','UNKNOWN')),
  CONSTRAINT traffic_observations_ports_check CHECK ((source_port IS NULL OR source_port BETWEEN 0 AND 65535) AND (destination_port IS NULL OR destination_port BETWEEN 0 AND 65535)),
  CONSTRAINT traffic_observations_counters_check CHECK (bytes_out >= 0 AND bytes_in >= 0 AND packets >= 0 AND duration_ms >= 0),
  CONSTRAINT traffic_observations_score_check CHECK (risk_score BETWEEN 0 AND 100),
  CONSTRAINT traffic_observations_severity_check CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  CONSTRAINT traffic_observations_action_check CHECK (recommended_action IN ('ALLOW','WARN','ISOLATE')),
  CONSTRAINT traffic_observations_heartbeat_check CHECK (observation_type <> 'HEARTBEAT' OR heartbeat_status IN ('HEALTHY','DEGRADED','OFFLINE'))
);

-- Preserve any legacy tenantless rows as inaccessible evidence rather than
-- deleting or guessing ownership. NOT VALID still blocks all new tenantless
-- inserts; clean databases receive the stronger column-level constraint.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM traffic_observations WHERE tenant_id IS NULL) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'traffic_observations'::regclass
        AND conname = 'traffic_observations_tenant_required_check'
    ) THEN
      ALTER TABLE traffic_observations
        ADD CONSTRAINT traffic_observations_tenant_required_check
        CHECK (tenant_id IS NOT NULL) NOT VALID;
    END IF;
  ELSE
    ALTER TABLE traffic_observations ALTER COLUMN tenant_id SET NOT NULL;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS traffic_observations_tenant_gateway_observation_uidx
  ON traffic_observations(tenant_id, gateway_id, observation_id);
CREATE INDEX IF NOT EXISTS traffic_observations_tenant_observed_idx
  ON traffic_observations(tenant_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS traffic_observations_action_observed_idx
  ON traffic_observations(recommended_action, observed_at DESC);
CREATE INDEX IF NOT EXISTS traffic_observations_protocol_observed_idx
  ON traffic_observations(protocol, observed_at DESC);

CREATE OR REPLACE FUNCTION reject_traffic_observation_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'traffic_observations are append-only' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS traffic_observations_immutable ON traffic_observations;
CREATE TRIGGER traffic_observations_immutable
  BEFORE UPDATE OR DELETE ON traffic_observations
  FOR EACH ROW EXECUTE FUNCTION reject_traffic_observation_mutation();