-- Node Exchange Ledger: signed envelopes, immutable hash-chain blocks, and route hops.
-- Private signing keys are never stored here. Run with the migration-owner role.

CREATE TABLE IF NOT EXISTS node_exchange_nodes (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  node_id text NOT NULL,
  role text NOT NULL,
  public_key text NOT NULL,
  key_version integer NOT NULL DEFAULT 1 CHECK (key_version > 0),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','REVOKED')),
  allowed_peer_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_sender_sequence bigint NOT NULL DEFAULT -1,
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz,
  revoked_at timestamptz,
  UNIQUE (tenant_id, node_id, key_version)
);
CREATE INDEX IF NOT EXISTS node_exchange_nodes_tenant_status_idx
  ON node_exchange_nodes(tenant_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS node_exchange_nodes_one_active_uidx
  ON node_exchange_nodes(tenant_id, node_id) WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS node_exchange_heads (
  scope_key text PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  sequence integer NOT NULL DEFAULT 0 CHECK (sequence >= 0),
  current_hash text NOT NULL DEFAULT 'GENESIS',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);

CREATE TABLE IF NOT EXISTS node_exchange_blocks (
  id serial PRIMARY KEY,
  scope_key text NOT NULL,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  block_sequence integer NOT NULL CHECK (block_sequence > 0),
  message_id text NOT NULL,
  correlation_id text NOT NULL,
  hop_sequence integer NOT NULL DEFAULT 0 CHECK (hop_sequence >= 0),
  sender_node_id text NOT NULL,
  recipient_node_id text NOT NULL,
  gateway_node_id text NOT NULL,
  protocol_version text NOT NULL,
  payload_type text NOT NULL,
  payload jsonb NOT NULL CHECK (octet_length(payload::text) <= 16384),
  envelope_hash text NOT NULL,
  payload_hash text NOT NULL,
  previous_block_hash text NOT NULL,
  previous_message_hash text NOT NULL,
  block_hash text NOT NULL,
  nonce text NOT NULL,
  sender_sequence integer NOT NULL CHECK (sender_sequence >= 0),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  signature text NOT NULL,
  signature_algorithm text NOT NULL CHECK (signature_algorithm = 'Ed25519'),
  key_version integer NOT NULL CHECK (key_version > 0),
  verification_status text NOT NULL CHECK (verification_status IN ('VERIFIED','REJECTED')),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope_key, block_sequence),
  UNIQUE (scope_key, block_hash),
  UNIQUE (scope_key, message_id, hop_sequence),
  UNIQUE (tenant_id, sender_node_id, key_version, sender_sequence),
  UNIQUE (tenant_id, sender_node_id, key_version, nonce)
);
CREATE INDEX IF NOT EXISTS node_exchange_blocks_tenant_accepted_idx
  ON node_exchange_blocks(tenant_id, accepted_at);
CREATE INDEX IF NOT EXISTS node_exchange_blocks_message_idx
  ON node_exchange_blocks(message_id);
CREATE INDEX IF NOT EXISTS node_exchange_blocks_correlation_idx
  ON node_exchange_blocks(correlation_id);

CREATE TABLE IF NOT EXISTS node_exchange_route_hops (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  message_id text NOT NULL,
  correlation_id text NOT NULL,
  hop_sequence integer NOT NULL CHECK (hop_sequence >= 0),
  source_node_id text NOT NULL,
  gateway_node_id text NOT NULL,
  destination_node_id text NOT NULL,
  block_id integer NOT NULL REFERENCES node_exchange_blocks(id) ON DELETE RESTRICT,
  received_at timestamptz NOT NULL,
  forwarded_at timestamptz,
  hop_hash text NOT NULL,
  payload_hash_verified boolean NOT NULL,
  signature_verified boolean NOT NULL,
  previous_block_verified boolean NOT NULL,
  route_policy_verified boolean NOT NULL,
  route_decision text NOT NULL CHECK (route_decision IN ('ACCEPTED','REJECTED','EXPIRED','REPLAYED')),
  reason_code text NOT NULL,
  UNIQUE (tenant_id, message_id, hop_sequence),
  UNIQUE (tenant_id, hop_hash)
);
CREATE INDEX IF NOT EXISTS node_exchange_route_hops_tenant_message_idx
  ON node_exchange_route_hops(tenant_id, message_id);
CREATE INDEX IF NOT EXISTS node_exchange_route_hops_correlation_idx
  ON node_exchange_route_hops(correlation_id);

CREATE OR REPLACE FUNCTION reject_node_exchange_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'node exchange ledger history is append-only' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS node_exchange_blocks_immutable ON node_exchange_blocks;
CREATE TRIGGER node_exchange_blocks_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON node_exchange_blocks
  FOR EACH STATEMENT EXECUTE FUNCTION reject_node_exchange_mutation();

DROP TRIGGER IF EXISTS node_exchange_route_hops_immutable ON node_exchange_route_hops;
CREATE TRIGGER node_exchange_route_hops_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON node_exchange_route_hops
  FOR EACH STATEMENT EXECUTE FUNCTION reject_node_exchange_mutation();

CREATE OR REPLACE FUNCTION protect_node_exchange_key_material()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id <> OLD.tenant_id
    OR NEW.node_id <> OLD.node_id
    OR NEW.key_version <> OLD.key_version
    OR NEW.public_key <> OLD.public_key
    OR NEW.role <> OLD.role
    OR NEW.allowed_peer_ids <> OLD.allowed_peer_ids
    OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'node exchange key material is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS node_exchange_key_material_immutable ON node_exchange_nodes;
CREATE TRIGGER node_exchange_key_material_immutable
  BEFORE UPDATE ON node_exchange_nodes
  FOR EACH ROW EXECUTE FUNCTION protect_node_exchange_key_material();

REVOKE ALL ON node_exchange_nodes, node_exchange_heads, node_exchange_blocks, node_exchange_route_hops FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER ON node_exchange_blocks, node_exchange_route_hops FROM PUBLIC;
REVOKE ALL ON SEQUENCE node_exchange_nodes_id_seq, node_exchange_blocks_id_seq, node_exchange_route_hops_id_seq FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE ON node_exchange_nodes TO CURRENT_USER;
GRANT SELECT, INSERT, UPDATE ON node_exchange_heads TO CURRENT_USER;
GRANT SELECT, INSERT ON node_exchange_blocks, node_exchange_route_hops TO CURRENT_USER;
GRANT USAGE, SELECT ON SEQUENCE node_exchange_nodes_id_seq, node_exchange_blocks_id_seq, node_exchange_route_hops_id_seq TO CURRENT_USER;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'soc_os_api') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON node_exchange_nodes TO soc_os_api';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON node_exchange_heads TO soc_os_api';
    EXECUTE 'GRANT SELECT, INSERT ON node_exchange_blocks, node_exchange_route_hops TO soc_os_api';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE node_exchange_nodes_id_seq, node_exchange_blocks_id_seq, node_exchange_route_hops_id_seq TO soc_os_api';
  END IF;
END $$;