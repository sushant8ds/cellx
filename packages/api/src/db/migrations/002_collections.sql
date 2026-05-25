-- =============================================================================
-- 002_collections.sql
-- Adds collection_id to records and a collections metadata table.
-- Idempotent: safe to run multiple times.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- collections table
-- Tracks uploaded files and external sheet connections per tenant.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS collections (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  source_type VARCHAR(50)  NOT NULL CHECK (source_type IN ('upload', 'google_sheets')),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

ALTER TABLE collections ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY tenant_isolation ON collections
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_collections_tenant
  ON collections(tenant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Add collection_id to records
-- Two-step: add nullable first (so existing rows are not rejected),
-- then backfill with a sentinel "unassigned" collection per tenant,
-- then add the NOT NULL constraint.
-- ---------------------------------------------------------------------------

-- Step 1: add the column as nullable
ALTER TABLE records
  ADD COLUMN IF NOT EXISTS collection_id UUID REFERENCES collections(id) ON DELETE SET NULL;

-- Step 2: backfill — create one "legacy" collection per tenant for pre-existing rows
DO $$
DECLARE
  t_id UUID;
  c_id UUID;
BEGIN
  FOR t_id IN SELECT DISTINCT tenant_id FROM records WHERE collection_id IS NULL LOOP
    INSERT INTO collections (tenant_id, name, source_type)
    VALUES (t_id, 'Legacy Records', 'upload')
    RETURNING id INTO c_id;

    UPDATE records SET collection_id = c_id
    WHERE tenant_id = t_id AND collection_id IS NULL;
  END LOOP;
END $$;

-- Step 3: now that all rows have a value, enforce NOT NULL
-- (ALTER COLUMN ... SET NOT NULL is safe after backfill)
DO $$
BEGIN
  ALTER TABLE records ALTER COLUMN collection_id SET NOT NULL;
EXCEPTION WHEN others THEN
  -- Already NOT NULL or no rows to backfill — safe to ignore
  NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Index for collection-scoped queries
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_records_collection
  ON records(tenant_id, collection_id);
