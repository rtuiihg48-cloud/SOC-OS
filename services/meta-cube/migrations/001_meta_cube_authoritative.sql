-- Apply with: psql "$DATABASE_URL" -f migrations/001_meta_cube_authoritative.sql
CREATE TABLE IF NOT EXISTS meta_cube_executions (
  id text PRIMARY KEY, idempotency_key text NOT NULL UNIQUE, name text NOT NULL,
  status text NOT NULL, payload jsonb NOT NULL, steps jsonb NOT NULL,
  completed_steps jsonb NOT NULL DEFAULT '[]'::jsonb, attempts jsonb NOT NULL DEFAULT '{}'::jsonb,
  max_retries integer NOT NULL, error text, created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL, finished_at timestamptz, data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS meta_cube_executions_status_created_idx ON meta_cube_executions(status, created_at DESC);
CREATE TABLE IF NOT EXISTS meta_cube_checkpoints (
  id text PRIMARY KEY, execution_id text NOT NULL REFERENCES meta_cube_executions(id) ON DELETE CASCADE,
  step_id text NOT NULL, created_at timestamptz NOT NULL, data jsonb NOT NULL,
  UNIQUE(execution_id, step_id)
);
CREATE INDEX IF NOT EXISTS meta_cube_checkpoints_execution_time_idx ON meta_cube_checkpoints(execution_id, created_at);
CREATE TABLE IF NOT EXISTS meta_cube_dlq (
  id text PRIMARY KEY, execution_id text NOT NULL REFERENCES meta_cube_executions(id) ON DELETE CASCADE,
  event_id text NOT NULL, step_id text NOT NULL, attempts integer NOT NULL, error text NOT NULL,
  created_at timestamptz NOT NULL, data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS meta_cube_dlq_execution_idx ON meta_cube_dlq(execution_id);