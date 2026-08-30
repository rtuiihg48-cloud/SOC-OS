-- Tenant rows are immutable lifecycle anchors for tenant-scoped audit evidence.
-- Deactivation replaces physical deletion and preserves all foreign-key targets.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tenants'::regclass
      AND conname = 'tenants_status_check'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_status_check CHECK (status IN ('ACTIVE', 'DISABLED'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS tenants_status_idx ON tenants(status);