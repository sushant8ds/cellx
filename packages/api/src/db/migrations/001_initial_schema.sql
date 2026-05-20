-- =============================================================================
-- 001_initial_schema.sql
-- Full DDL for Universal Dynamic Data & Calibration Platform
-- Idempotent: safe to run multiple times
-- =============================================================================

-- ---------------------------------------------------------------------------
-- tenants
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  sso_config  JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id),
  email                 TEXT NOT NULL,
  password_hash         TEXT,
  salt                  TEXT,
  role                  TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'operator')),
  is_active             BOOLEAN NOT NULL DEFAULT true,
  failed_login_attempts INT NOT NULL DEFAULT 0,
  is_superadmin         BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

-- ---------------------------------------------------------------------------
-- dynamic_fields
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dynamic_fields (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  name            TEXT NOT NULL,
  field_type      TEXT NOT NULL CHECK (field_type IN ('text', 'integer', 'float', 'date', 'status')),
  dropdown_values TEXT[],
  constraints     JSONB,
  display_order   INT NOT NULL DEFAULT 0,
  is_deleted      BOOLEAN NOT NULL DEFAULT false,
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- records
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS records (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  data        JSONB NOT NULL DEFAULT '{}',
  version     INT NOT NULL DEFAULT 1,
  is_deleted  BOOLEAN NOT NULL DEFAULT false,
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- formulas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS formulas (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id),
  name                 TEXT NOT NULL,
  target_field_id      UUID NOT NULL REFERENCES dynamic_fields(id),
  expression           TEXT NOT NULL,
  ast                  JSONB NOT NULL,
  referenced_field_ids UUID[],
  is_active            BOOLEAN NOT NULL DEFAULT true,
  has_error            BOOLEAN NOT NULL DEFAULT false,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- alert_rules
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alert_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  name            TEXT NOT NULL,
  target_field_id UUID NOT NULL REFERENCES dynamic_fields(id),
  operator        TEXT NOT NULL CHECK (operator IN ('eq', 'neq', 'lt', 'gt', 'lte', 'gte')),
  threshold       TEXT NOT NULL,
  recipients      TEXT[] NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  last_evaluated  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- audit_log (partitioned by range on created_at)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id            BIGSERIAL,
  tenant_id     UUID NOT NULL,
  actor_user_id UUID NOT NULL,
  record_id     UUID,
  entity_type   TEXT NOT NULL,
  action        TEXT NOT NULL,
  field_name    TEXT,
  old_value     TEXT,
  new_value     TEXT,
  metadata      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Default catch-all partition (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'audit_log_default' AND n.nspname = 'public'
  ) THEN
    EXECUTE 'CREATE TABLE audit_log_default PARTITION OF audit_log DEFAULT';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- api_keys
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_keys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  key_hash    TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'operator')),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  last_used   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- notification_log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  alert_rule_id UUID NOT NULL REFERENCES alert_rules(id),
  status        TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
  attempt_count INT NOT NULL DEFAULT 0,
  last_attempt  TIMESTAMPTZ,
  error_message TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- background_jobs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS background_jobs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  type             TEXT NOT NULL CHECK (type IN ('import', 'export')),
  status           TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed'))
                   DEFAULT 'queued',
  progress_percent INT NOT NULL DEFAULT 0,
  result_url       TEXT,
  error_message    TEXT,
  metadata         JSONB,
  created_by       UUID NOT NULL REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- constraint_rules (Universal Assignment Engine)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS constraint_rules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,
  config      JSONB NOT NULL DEFAULT '{}',
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- Row-Level Security
-- =============================================================================

ALTER TABLE records           ENABLE ROW LEVEL SECURITY;
ALTER TABLE dynamic_fields    ENABLE ROW LEVEL SECURITY;
ALTER TABLE formulas          ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_rules       ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log         ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys          ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_log  ENABLE ROW LEVEL SECURITY;
ALTER TABLE background_jobs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE constraint_rules  ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY tenant_isolation ON records
    USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY tenant_isolation ON dynamic_fields
    USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY tenant_isolation ON formulas
    USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY tenant_isolation ON alert_rules
    USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY tenant_isolation ON audit_log
    USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY tenant_isolation ON api_keys
    USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY tenant_isolation ON notification_log
    USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY tenant_isolation ON background_jobs
    USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY tenant_isolation ON constraint_rules
    USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================================
-- Indexes
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_records_tenant_id
  ON records(tenant_id) WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_records_data_gin
  ON records USING GIN(data);

CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_date
  ON audit_log(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_record
  ON audit_log(record_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dynamic_fields_tenant
  ON dynamic_fields(tenant_id) WHERE is_deleted = false;

-- Partial unique index: field names must be unique per tenant among active (non-deleted) fields
CREATE UNIQUE INDEX IF NOT EXISTS idx_dynamic_fields_unique_name
  ON dynamic_fields(tenant_id, name) WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_background_jobs_tenant
  ON background_jobs(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_constraint_rules_tenant
  ON constraint_rules(tenant_id) WHERE is_active = true;
