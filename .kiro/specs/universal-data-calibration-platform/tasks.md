# Implementation Plan: Universal Dynamic Data & Calibration Platform

## Overview

Incremental implementation of the platform in TypeScript (Node.js + Express backend, React + TypeScript frontend), building from the data layer upward through services, API routes, background workers, and finally the frontend. Each task wires into the previous, with no orphaned code.

## Tasks

- [x] 0. CI/CD pipeline and ephemeral database testing infrastructure
  - Create `.github/workflows/ci.yml` GitHub Actions workflow
  - Add a `test` job that: spins up a PostgreSQL service container (or uses Testcontainers in Node.js), runs all DDL migrations against it, executes the full `fast-check` property test suite (`vitest --run`), and tears down on completion
  - Add a `lint` job running ESLint + TypeScript type-check on both `packages/api` and `packages/web`
  - Configure the workflow to trigger on every push and pull request to `main`
  - Store `DATABASE_URL` and other test secrets as GitHub Actions secrets; never hardcode credentials
  - _Requirements: all — this gates every subsequent task_

- [x] 1. Project scaffolding and database foundation
  - Initialize monorepo with `packages/api` (Node.js/Express/TypeScript) and `packages/web` (React/TypeScript/Vite)
  - Create `packages/api/src/db/migrations/` directory and write all DDL migration files: `tenants`, `users`, `dynamic_fields`, `records`, `formulas`, `alert_rules`, `audit_log` (partitioned), `api_keys`, `notification_log`, `background_jobs`
  - Enable RLS on all tenant-scoped tables and create the `tenant_isolation` policy using `app.current_tenant_id`
  - Create all key indexes including GIN index on `records.data`
  - Configure PgBouncer connection string in API config; wire `pg` pool through PgBouncer
  - Set up secrets loading from AWS Secrets Manager / Vault at startup
  - _Requirements: 1.1, 1.2, 12.1_

  - [x]* 1.1 Smoke test: verify RLS policies are enabled on all tenant-scoped tables
    - Assert `pg_policies` contains a row for each of: `records`, `dynamic_fields`, `formulas`, `alert_rules`, `audit_log`, `api_keys`, `notification_log`, `background_jobs`
    - _Requirements: 1.1_

- [x] 2. Authentication and RBAC middleware
  - [x] 2.1 Implement password hashing with per-user salt (bcrypt/argon2) in `AuthService`
    - `hashPassword(plain, salt)` and `verifyPassword(plain, hash, salt)` utilities
    - `POST /auth/login` route: authenticate, issue JWT with `tenant_id` + `role` claims, increment `failed_login_attempts` on failure
    - Generic error message on failure — no field-level disclosure
    - _Requirements: 2.1, 2.2, 2.3_

  - [x]* 2.2 Write property test for password hashing uniqueness
    - **Property 3: Password Hashing Uniqueness**
    - **Validates: Requirements 2.1**

  - [x]* 2.3 Write property test for invalid credential response indistinguishability
    - **Property 4: Invalid Credential Response Indistinguishability**
    - **Validates: Requirements 2.3**

  - [x] 2.4 Implement `AuthMiddleware` (JWT decode + `tenant_id` extraction) and `TenantIsolationMiddleware`
    - Set `SET LOCAL app.current_tenant_id` at the start of every transaction
    - `TenantIsolationMiddleware` validates that the resource's `tenant_id` matches the session tenant; returns `403` on mismatch and writes audit log
    - Attach Pino structured logger to every request: log `{ trace_id, tenant_id, user_id, method, path, status, duration_ms }` on response
    - Attach OpenTelemetry trace span to every request via `@opentelemetry/sdk-node`; propagate `trace_id` into all downstream service calls and BullMQ job payloads so background job failures can be correlated back to the originating HTTP request
    - _Requirements: 1.2, 1.3_

  - [x] 2.5 Implement `RBACMiddleware` and permission matrix
    - Define permission map: Admin / Manager / Operator × all actions
    - Deny with `403` and permission error when action is outside role's set
    - _Requirements: 2.4, 2.5_

  - [x]* 2.6 Write property test for RBAC enforcement
    - **Property 5: RBAC Enforcement**
    - **Validates: Requirements 2.4, 2.5**

  - [x] 2.7 Implement SSO routes: `POST /auth/sso/saml` and `POST /auth/sso/oauth2/callback` using Passport.js
    - Map IdP group claims to platform roles per tenant's `sso_config`
    - _Requirements: 2.7, 2.8_

  - [x]* 2.8 Write property test for SSO claim-to-role mapping
    - **Property 6: SSO Claim-to-Role Mapping**
    - **Validates: Requirements 2.8**

  - [x] 2.9 Implement `ApiKeyService`: generate (hashed), rotate, revoke API keys; `POST/GET/DELETE /tenants/:tenantId/api-keys` routes
    - Raw key shown once at creation; only hash stored
    - Return `401` with log entry for invalid/expired/revoked keys
    - _Requirements: 14.1, 14.3, 14.5_

  - [x]* 2.10 Write property test for API key rejection
    - **Property 34: API Key Rejection**
    - **Validates: Requirements 14.1, 14.3**

  - [x] 2.11 Implement `Admin` user management routes: create, deactivate, reassign roles within tenant
    - _Requirements: 2.6_

- [x] 3. Checkpoint — Ensure all auth and middleware tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Tenant service and multi-tenant isolation
  - [x] 4.1 Implement `TenantService`: create tenant, fetch tenant by slug/id
    - Onboarding a new tenant must not touch existing tenants' rows
    - _Requirements: 1.4_

  - [x]* 4.2 Write property test for tenant data isolation
    - **Property 1: Tenant Data Isolation**
    - **Validates: Requirements 1.1, 1.2, 1.3**

  - [x]* 4.3 Write property test for new tenant onboarding isolation
    - **Property 2: New Tenant Onboarding Does Not Affect Existing Tenants**
    - **Validates: Requirements 1.4**

  - [x] 4.4 Implement `PlatformService` and superadmin role
    - Add a `is_superadmin` boolean column to `users` (default false); superadmin users bypass tenant RLS by setting `app.current_tenant_id` to a wildcard sentinel value
    - `GET /system-admin/tenants` — list all tenants with record counts and status
    - `POST /system-admin/tenants/:tenantId/suspend` — mark tenant as suspended; all subsequent requests from that tenant return `403`
    - `POST /system-admin/tenants/:tenantId/activate` — re-activate a suspended tenant
    - `GET /system-admin/health` — return PgBouncer pool stats, Redis memory, BullMQ queue depths, and API node uptime
    - `POST /system-admin/backups/trigger` — manually trigger a full database backup job
    - All `/system-admin/*` routes are gated by a `SuperadminMiddleware` that checks `is_superadmin = true`; any non-superadmin request returns `403` with no data leakage

- [x] 5. Dynamic Schema Engine
  - [x] 5.1 Implement `SchemaService`: CRUD for `dynamic_fields`
    - `POST /tenants/:tenantId/schema/fields` — add field, enforce unique name within tenant (active fields only)
    - `PATCH /tenants/:tenantId/schema/fields/:fieldId` — rename field; cascade rename to `formulas.ast` and `alert_rules.target_field_id` references
    - `DELETE /tenants/:tenantId/schema/fields/:fieldId` — soft delete; mark dependent formulas/alert rules as `has_error = true`; write audit log
    - `GET /tenants/:tenantId/schema` — return active fields ordered by `display_order`
    - Enforce minimum 200 fields per tenant
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x]* 5.2 Write property test for dynamic field availability after addition
    - **Property 10: Dynamic Field Availability After Addition**
    - **Validates: Requirements 4.2**

  - [x]* 5.3 Write property test for field rename consistency
    - **Property 11: Field Rename Consistency**
    - **Validates: Requirements 4.3**

  - [x]* 5.4 Write property test for field deletion invalidating dependents
    - **Property 12: Field Deletion Invalidates Dependents**
    - **Validates: Requirements 4.4**

  - [x]* 5.5 Write property test for dynamic field name uniqueness
    - **Property 13: Dynamic Field Name Uniqueness**
    - **Validates: Requirements 4.5**

  - [x] 5.6 Implement validation constraint enforcement in `SchemaService` and record write path
    - Validate min/max for Integer/Float, maxLength for Text, dateDirection for Date on every record write
    - Return `422` with structured error body on violation
    - _Requirements: 4.10, 4.11_

  - [x]* 5.7 Write property test for validation constraint enforcement
    - **Property 16: Validation Constraint Enforcement**
    - **Validates: Requirements 4.11**

  - [x] 5.8 Implement on-demand B-tree functional index creation/drop in `SchemaService`
    - `CREATE INDEX CONCURRENTLY` when a field is marked sortable; drop on field delete or type change
    - _Requirements: 8.4, 13.2_

- [x] 6. Record service and live grid API
  - [x] 6.1 Implement `RecordService`: CRUD for `records` with tenant isolation
    - `GET /tenants/:tenantId/records` — paginated (cursor-based), filterable by any dynamic field, multi-column sortable; return within 500ms for 50k records
    - `POST /tenants/:tenantId/records` — create record, run formula recalculation, write audit log
    - `PATCH /tenants/:tenantId/records/:recordId` — inline edit with OCC version check; validate, save, recalculate formulas, write audit log atomically
    - `DELETE /tenants/:tenantId/records/:recordId` — soft delete; write audit log
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.7, 8.8, 13.1, 13.2, 14.2_

  - [x]* 6.2 Write property test for filter correctness
    - **Property 25: Filter Correctness**
    - **Validates: Requirements 8.2, 8.3**

  - [x]* 6.3 Write property test for multi-column sort correctness
    - **Property 26: Multi-Column Sort Correctness**
    - **Validates: Requirements 8.4**

  - [x]* 6.4 Write property test for inline edit atomicity
    - **Property 27: Inline Edit Atomicity**
    - **Validates: Requirements 8.5**

  - [x]* 6.5 Write property test for optimistic concurrency control
    - **Property 28: Optimistic Concurrency Control**
    - **Validates: Requirements 8.7**

  - [x]* 6.6 Write property test for soft delete retention
    - **Property 14: Soft Delete Retention**
    - **Validates: Requirements 4.7, 8.8**

  - [x] 6.7 Implement bulk update and bulk delete endpoints
    - `POST /tenants/:tenantId/records/bulk-update` — atomic transaction across all N records; write N individual audit log entries
    - `POST /tenants/:tenantId/records/bulk-delete` — soft delete N records atomically; enforce RBAC
    - _Requirements: 8.11, 8.12, 8.13_

  - [x]* 6.8 Write property test for bulk update atomicity
    - **Property 29: Bulk Update Atomicity**
    - **Validates: Requirements 8.11**

  - [x]* 6.9 Write property test for bulk update audit log completeness
    - **Property 30: Bulk Update Audit Log Completeness**
    - **Validates: Requirements 8.12**

  - [x] 6.10 Implement soft-delete restore and purge cron job
    - `GET /tenants/:tenantId/records?archived=true` — return soft-deleted records
    - Restore endpoint: un-soft-delete within 30-day window
    - Purge cron: permanently delete items older than 30 days; write audit log entry per purged item
    - _Requirements: 4.8, 8.9, 4.9, 8.10_

  - [x]* 6.11 Write property test for soft delete restore round-trip
    - **Property 15: Soft Delete Restore Round-Trip**
    - **Validates: Requirements 4.8, 8.9**

- [x] 7. Checkpoint — Ensure all schema and record tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Audit log service
  - [x] 8.1 Implement `AuditService`: append-only writes to `audit_log`
    - Wire `AuditMiddleware` to all mutating routes (record, schema, formula, alert rule operations)
    - Enforce no UPDATE/DELETE permissions on `audit_log` table at DB level
    - `GET /tenants/:tenantId/audit-log` — filterable by date range, user, record ID; target < 500ms at 1M entries
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x]* 8.2 Write property test for audit log completeness
    - **Property 23: Audit Log Completeness**
    - **Validates: Requirements 7.1, 7.2, 6.6**

  - [x]* 8.3 Write property test for audit log immutability
    - **Property 24: Audit Log Immutability**
    - **Validates: Requirements 7.3**

- [x] 9. Formula engine
  - [x] 9.1 Implement formula parser: tokenizer + recursive-descent parser producing typed `ASTNode`
    - Support arithmetic (+, -, *, /), date arithmetic (`date_add`), and IF/THEN/ELSE (`if` node)
    - Reject invalid syntax with descriptive error and position
    - _Requirements: 5.1, 5.2_

  - [x]* 9.2 Write property test for formula syntax round-trip
    - **Property 17: Formula Syntax Round-Trip**
    - **Validates: Requirements 5.2**

  - [x] 9.3 Implement formula evaluator: walk AST against a record's `data` JSONB
    - Handle division-by-zero → set derived field to `null` with `error_state: "division_by_zero"`
    - Handle type mismatch → `null` with `error_state: "type_mismatch"`
    - Enforce a max AST depth limit (default: 20 nodes) at parse time; reject formulas exceeding the limit with a descriptive `422` error to prevent runaway evaluation
    - For bulk updates: process formula recalculations in chunks of 500 records using `setImmediate` between chunks so the Node.js event loop can continue serving other requests during large batch operations
    - _Requirements: 5.3, 5.4_

  - [x] 9.4 Implement `FormulaService`: CRUD for `formulas` table; wire recalculation into `RecordService` on every record create/update
    - `GET/POST/PATCH/DELETE /tenants/:tenantId/formulas`
    - On save: validate syntax + referenced field names; store AST; set `has_error = false`
    - On record write: recalculate all formulas whose `referenced_field_ids` overlap updated fields
    - _Requirements: 5.2, 5.3, 5.5_

  - [x]* 9.5 Write property test for formula recalculation on field update
    - **Property 18: Formula Recalculation on Field Update**
    - **Validates: Requirements 5.3**

  - [x]* 9.6 Write property test for formula inverse consistency
    - **Property 19: Formula Inverse Consistency**
    - **Validates: Requirements 5.6**

- [x] 10. Alert and notification system
  - [x] 10.1 Implement `AlertService`: CRUD for `alert_rules`
    - `GET/POST/PATCH/DELETE /tenants/:tenantId/alert-rules`
    - `POST /tenants/:tenantId/alert-rules/:ruleId/trigger` — manual trigger
    - Activate/deactivate/delete one rule without touching others
    - _Requirements: 6.1, 6.5, 6.7_

  - [x]* 10.2 Write property test for alert rule state change isolation
    - **Property 22: Alert Rule State Change Isolation**
    - **Validates: Requirements 6.7**

  - [x] 10.3 Implement Notification Daemon worker (BullMQ)
    - Scheduled job (minimum 1-hour resolution): evaluate all active alert rules; for each rule whose condition is met, enqueue email jobs per recipient
    - Email delivery via Nodemailer; retry up to 3 times with exponential backoff (1s, 2s, 4s); mark `notification_log.status = 'failed'` after 3 failures
    - Write audit log entry on each alert trigger (rule name, record ID, timestamp)
    - _Requirements: 6.2, 6.3, 6.4, 6.6_

  - [x]* 10.4 Write property test for alert notification completeness
    - **Property 20: Alert Notification Completeness**
    - **Validates: Requirements 6.3**

  - [x]* 10.5 Write property test for email retry with exponential backoff
    - **Property 21: Email Retry with Exponential Backoff**
    - **Validates: Requirements 6.4**

- [x] 11. Checkpoint — Ensure all formula and alert tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Import and export subsystem
  - [x] 12.1 Implement `ImportService` and BullMQ import worker
    - `POST /tenants/:tenantId/imports` — accept multipart upload (`.xlsx`/`.csv`, ≤ 50 MB); store raw file to S3; enqueue import job; return `202 { jobId }`
    - Worker: parse headers, infer types, apply column mapping, bulk INSERT valid rows as records, skip rows with type-coercion errors (log per-row reason), update `background_jobs` with `progress_percent`
    - Reject malformed/password-protected/unsupported files with descriptive `400`; reject oversized files with `413`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x]* 12.2 Write property test for import file acceptance boundary
    - **Property 7: Import File Acceptance Boundary**
    - **Validates: Requirements 3.1, 3.3**

  - [x]* 12.3 Write property test for import row count accuracy
    - **Property 8: Import Row Count Accuracy**
    - **Validates: Requirements 3.5, 3.6**

  - [x] 12.4 Implement `ExportService` and BullMQ export worker
    - `POST /tenants/:tenantId/exports` — accept `{ filters, sort, format }`, enqueue export job, return `202 { jobId }`
    - Worker: query filtered/sorted records, generate `.xlsx` (ExcelJS) or `.pdf` (PDFKit) with visible columns, filter criteria header annotation, tenant name, and export timestamp; upload to S3; store pre-signed URL in `background_jobs.result_url`
    - _Requirements: 11.1, 11.2, 11.3_

  - [x]* 12.5 Write property test for export file completeness
    - **Property 33: Export File Completeness**
    - **Validates: Requirements 11.3**

  - [x] 12.6 Implement `GET /tenants/:tenantId/jobs/:jobId` polling endpoint
    - Return `{ status, progress_percent, result_url }`; enforce tenant isolation (404 if job belongs to different tenant)
    - _Requirements: 11.2_

  - [x]* 12.7 Write property test for import–export round trip
    - **Property 9: Import–Export Round Trip**
    - **Validates: Requirements 3.7, 11.4**

- [x] 13. Real-time dashboard (SSE)
  - [x] 13.1 Implement `SSEService` and `GET /tenants/:tenantId/events/stream` endpoint
    - Hold open HTTP connection; subscribe to Redis channel `tenant:<id>:dashboard`
    - On record status change: API publishes `dashboard_update` to Redis; SSE handler forwards to all connected clients for that tenant
    - Also publish `record_update` events (containing the updated record payload) to the same SSE stream so the frontend Grid can react in real-time
    - _Requirements: 9.2, 9.4_

  - [x] 13.2 Implement `DashboardService`: compute widget counts (Safe, Warning, Danger/Overdue) from active records
    - `GET /tenants/:tenantId/dashboard` — return counts per status category
    - Publish `dashboard_update` event to Redis after any record mutation that changes a status-category count
    - _Requirements: 9.1, 9.3_

  - [x]* 13.3 Write property test for dashboard count accuracy
    - **Property 31: Dashboard Count Accuracy**
    - **Validates: Requirements 9.1**

- [x] 14. Checkpoint — Ensure all import/export and dashboard tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. React frontend — Auth UI and routing
  - Scaffold React + TypeScript + Vite app in `packages/web`
  - Implement login page (email/password form) and SSO redirect flow
  - Set up React Router with protected routes gated by JWT/session
  - Configure TanStack Query client for server state management
  - _Requirements: 2.1, 2.2, 2.7_

- [x] 16. React frontend — Live Grid component
  - [x] 16.1 Implement `Grid` component using TanStack Table with virtualization
    - Render up to 50,000 rows with frame rendering < 100ms per interaction
    - Column headers derived from tenant schema; color-code rows by status (green/yellow/red)
    - _Requirements: 8.1, 8.6_

  - [x] 16.2 Implement filter bar and multi-column sort controls
    - Type-appropriate filter operators per field type; wire to `GET /records` query params
    - _Requirements: 8.2, 8.3, 8.4_

  - [x] 16.3 Implement inline cell editing with OCC
    - On cell blur/enter: PATCH record with current version token; show concurrency error toast on `409`
    - _Requirements: 8.5, 8.7_

  - [x] 16.4 Implement bulk select, bulk update modal, and bulk delete
    - Checkbox column; bulk update dialog for selecting field + new value; confirm before bulk delete
    - _Requirements: 8.11, 8.12, 8.13_

  - [x] 16.5 Implement Trash/Archive view with restore action
    - Toggle archived view; restore button calls restore endpoint; disabled after 30-day window
    - _Requirements: 4.8, 8.9_

- [x] 17. React frontend — Dashboard component
  - Implement status widget cards (Safe, Warning, Danger, Overdue) with counts from `DashboardService`
  - Subscribe to SSE stream; update counts on `dashboard_update` events without page refresh
  - On `record_update` SSE event: call `queryClient.setQueryData(['records', tenantId], ...)` to patch the affected row in the TanStack Query cache, giving the Grid a real-time multiplayer update without a full refetch; fall back to `queryClient.invalidateQueries({ queryKey: ['records'] })` if the record is not currently in cache
  - Clicking a widget navigates to Grid pre-filtered to that status category
  - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [x] 18. React frontend — Configurator Workspace
  - [x] 18.1 Implement Schema management UI (Dynamic Fields list, add/rename/delete field forms)
    - Show dependency warning modal before applying changes that would invalidate formulas or alert rules; require explicit confirmation
    - _Requirements: 10.1, 10.2, 10.4_

  - [x]* 18.2 Write property test for configurator change dependency warning
    - **Property 32: Configurator Change Dependency Warning**
    - **Validates: Requirements 10.4**

  - [x] 18.3 Implement Formula Builder UI
    - Formula expression text editor with field-name autocomplete; display active/inactive/error status per formula
    - _Requirements: 5.1, 10.3_

  - [x] 18.4 Implement Alert Rule configuration UI
    - Create/edit/delete alert rule form; activate/deactivate toggle; manual trigger button; display active/inactive/error status
    - _Requirements: 6.1, 6.5, 6.7, 10.3_

  - [x] 18.5 Implement Importer / Mapper UI
    - File upload dropzone; column mapping table (source column → schema field or new field); progress polling via `GET /jobs/:jobId`; display import summary (rows imported, rows skipped with reasons)
    - _Requirements: 3.4, 3.5, 3.6_

  - [x] 18.6 Implement API Key management UI
    - List keys, generate new key (show raw key once), rotate, revoke
    - _Requirements: 14.5_

  - [x] 18.7 Implement Superadmin UI at `/system-admin` (hidden route, superadmin only)
    - Tenant list table with status (active/suspended) and record counts; suspend/activate buttons
    - Platform health panel: PgBouncer pool stats, Redis memory, BullMQ queue depths
    - Manual backup trigger button
    - Route is not linked from the main nav; only accessible by direct URL; `SuperadminMiddleware` enforces server-side access control

- [x] 19. React frontend — Report Export UI
  - Export button in Grid toolbar: opens dialog to choose format (xlsx/pdf); triggers `POST /exports`; polls job status; downloads file from `result_url` on completion
  - _Requirements: 11.1, 11.2_

- [x] 20. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 21. Smart Data Preprocessing and Cleaning
  - [x] 21.1 Implement `PreprocessingScanner` in `packages/api/src/import/preprocessing.ts`
    - `scanFile(rows, headers): PreprocessingReport` — pure function, no DB calls
    - Detect: missing values, type mismatches, duplicate rows, inconsistent date/number formats
    - Build `cleaningActions` list and `flaggedRows` list
    - _Requirements: 15.1, 15.2_

  - [x] 21.2 Implement auto-cleaning in the import worker
    - Apply date normalization (→ ISO 8601), number normalization, whitespace trim, duplicate removal
    - Accept user `overrides` and `fillValues` from the confirm request
    - Store `PreprocessingReport` as `background_jobs.metadata`
    - _Requirements: 15.3, 15.4, 15.5, 15.6, 15.7_

  - [x] 21.3 Add `POST /tenants/:tenantId/imports/:jobId/confirm` endpoint
    - Accept `{ overrides, fillValues, skipRows }` body
    - Trigger the actual bulk INSERT after cleaning is applied
    - _Requirements: 15.5, 15.6_

- [ ] 21.4 Write property test for preprocessing idempotency
    - **Property 35: Preprocessing Idempotency**
    - Applying cleaning then re-importing the cleaned data produces an equivalent Record set
    - **Validates: Requirements 15.8**

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Property tests use `fast-check` with a minimum of 100 iterations, tagged `Feature: universal-data-calibration-platform, Property N: <title>`
- All 34 correctness properties from the design document are covered by property test sub-tasks
- Checkpoints ensure incremental validation at logical boundaries
- Task 0 (CI/CD) must be completed first — all subsequent tasks depend on the automated test pipeline
- Pino + OpenTelemetry (Task 2.4) instrument every request and background job with a `trace_id` for cross-service debugging
- Formula evaluator (Task 9.3) enforces max AST depth and chunks bulk recalculations to prevent event loop starvation
- SSE `record_update` events (Task 13.1 + 17) wire directly into TanStack Query cache for real-time Grid synchronization across concurrent users
- Superadmin role (Task 4.4 + 18.7) is cross-tenant and bypasses RLS; it is strictly gated by `SuperadminMiddleware` on every route

## AI Agent Tasks

- [ ] 22. AI Orchestration Agent (Text-to-Software)
  - [ ] 22.1 Add `openai` dependency and `AIService` in `packages/api/src/ai/ai.service.ts`
    - `generateDataProfile(rows, headers): DataProfile` — pure function, samples first 50 rows
    - `chat(tenantId, sessionId, message, dataProfile): AsyncIterable<ChatChunk>` — streams LLM response
    - Maintain conversation history in Redis (TTL 24h) keyed by `ai:session:<tenantId>:<sessionId>`
    - Define all 9 tool definitions (create/list/delete for fields, formulas, alert rules)
    - Execute tool calls server-side using the platform's own service functions (SchemaService, FormulaService, AlertService) with the user's tenantId
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.8_

  - [ ] 22.2 Add AI chat router `packages/api/src/ai/ai.router.ts`
    - `POST /tenants/:tenantId/ai/chat` — accepts `{ message, sessionId?, dataProfile? }`, streams response via SSE
    - `DELETE /tenants/:tenantId/ai/sessions/:sessionId` — clear conversation history
    - Gated by AuthMiddleware + TenantIsolationMiddleware + requirePermission('schema:write')
    - _Requirements: 16.2, 16.5, 16.6, 16.7_

  - [ ] 22.3 Update import flow to generate DataProfile on upload
    - After `parseFile`, call `generateDataProfile(rows, headers)` and include it in the job metadata
    - Return `dataProfile` in the `POST /imports` response alongside the preprocessing report
    - _Requirements: 16.1_

  - [ ] 22.4 React frontend — AI Chat component `packages/web/src/components/AiChat.tsx`
    - Chat UI: message input, send button, scrollable message history
    - Each AI message shows an activity log of tool calls made (e.g., "✅ Created field: Calibration Date")
    - Streams response tokens as they arrive via SSE
    - Undo button per action: calls the corresponding delete endpoint
    - Shown in the Configurator workspace as a new "AI Assistant" tab
    - _Requirements: 16.2, 16.5, 16.6_

- [ ] 23. Universal Constraint-Based Assignment Engine
  - [ ] 23.1 Implement `ConstraintSolver` in `packages/api/src/solver/solver.service.ts`
    - `buildProblem(tenantId, resourceSchemaId, slotSchemaId, itemSchemaId, constraintRuleIds)` — loads records and rules from DB
    - `solve(problem): SolverResult` — greedy first-fit with backtracking; returns assignments + conflict report
    - `validateAssignments(assignments, rules): ValidationResult[]` — re-validates after manual overrides
    - Deterministic: same inputs + rules always produce equivalent output (Property 35)
    - _Requirements: 17.3, 17.4, 17.9_

  - [ ] 23.2 Implement `ConstraintRuleBuilder` service and DB table
    - `constraint_rules` table: id, tenant_id, name, type, config (JSONB), is_active
    - CRUD API: `GET/POST/PATCH/DELETE /tenants/:tenantId/constraint-rules`
    - Support all 8 constraint types: min_assignments, max_assignments, no_simultaneous, group_together, capacity_limit, priority_order, exclusion, formula
    - _Requirements: 17.2_

  - [ ] 23.3 Implement solver router `packages/api/src/solver/solver.router.ts`
    - `POST /tenants/:tenantId/solver/run` — async job, returns jobId
    - `GET  /tenants/:tenantId/solver/assignments` — assignment matrix
    - `POST /tenants/:tenantId/solver/assignments/:id/override` — manual override + re-validate
    - `GET  /tenants/:tenantId/solver/conflicts` — unresolvable violations
    - `POST /tenants/:tenantId/solver/export` — PDF/Excel with configurable template
    - _Requirements: 17.5, 17.6, 17.7_

  - [ ] 23.4 Implement `ExportTemplate` engine
    - User-defined template sections: matrix, list, summary, header, footer
    - Template stored as a record in the DB (JSONB config)
    - Renderer: takes assignments + template → generates Excel/PDF
    - _Requirements: 17.5_

  - [ ] 23.5 React frontend — Constraint Rule Builder UI
    - Visual rule builder: select constraint type → configure parameters
    - Rule list with active/inactive toggle
    - "Run Solver" button → polls job → shows assignment matrix in Grid
    - Conflict report panel with manual override controls
    - Export button with template selector
    - _Requirements: 17.1, 17.2, 17.5, 17.6, 17.7_

  - [ ] 23.6 Wire AI Agent to solver
    - Add solver tools to AI agent: `run_solver`, `list_constraint_rules`, `create_constraint_rule`
    - AI can configure the full assignment setup from plain language
    - _Requirements: 17.8_

  - [ ]* 23.7 Write property test for solver determinism
    - **Property 35: Solver Determinism**
    - Running solver twice on same inputs produces equivalent assignments
    - **Validates: Requirements 17.9**
