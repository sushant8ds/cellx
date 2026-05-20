/**
 * RecordService — CRUD for records with tenant isolation
 * Feature: universal-data-calibration-platform
 */
import { pool } from '../db/pool';
import { getSchema, validateRecordData } from '../schema/schema.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DataRecord {
  id: string;
  tenant_id: string;
  data: Record<string, unknown>;
  version: number;
  is_deleted: boolean;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface ListRecordsOptions {
  limit?: number;
  cursor?: string;
  sortBy?: string;
  filters?: Record<string, string>;
  archived?: boolean;
}

export interface ListRecordsResult {
  records: DataRecord[];
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ConcurrencyError extends Error {
  constructor() {
    super('Record was modified by another user. Please refresh and retry.');
    this.name = 'ConcurrencyError';
  }
}

export class NotFoundError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends Error {
  constructor(msg: string, public field: string, public constraint: string) {
    super(msg);
    this.name = 'ValidationError';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000000';

function encodeCursor(id: string, updatedAt: Date): string {
  return Buffer.from(JSON.stringify({ id, updated_at: updatedAt.toISOString() })).toString('base64');
}

function decodeCursor(cursor: string): { id: string; updated_at: string } | null {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

async function writeAuditLog(
  tenantId: string,
  actorUserId: string,
  recordId: string | null,
  action: string,
  oldValue?: string,
  newValue?: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO audit_log
       (tenant_id, actor_user_id, record_id, entity_type, action, old_value, new_value)
     VALUES ($1, $2, $3, 'record', $4, $5, $6)`,
    [tenantId, actorUserId || SYSTEM_ACTOR, recordId, action, oldValue ?? null, newValue ?? null],
  );
}

// ---------------------------------------------------------------------------
// listRecords
// ---------------------------------------------------------------------------

export async function listRecords(
  tenantId: string,
  options: ListRecordsOptions = {},
): Promise<ListRecordsResult> {
  const limit = Math.min(options.limit ?? 100, 1000);
  const archived = options.archived ?? false;

  const params: unknown[] = [tenantId];
  let paramIdx = 2;

  let whereClause = `WHERE tenant_id = $1 AND is_deleted = ${archived ? 'true' : 'false'}`;

  // Cursor-based pagination
  if (options.cursor) {
    const decoded = decodeCursor(options.cursor);
    if (decoded) {
      whereClause += ` AND (updated_at, id) < ($${paramIdx}::timestamptz, $${paramIdx + 1}::uuid)`;
      params.push(decoded.updated_at, decoded.id);
      paramIdx += 2;
    }
  }

  // Filters: data->>'fieldId' = value
  if (options.filters) {
    for (const [fieldId, value] of Object.entries(options.filters)) {
      const sanitizedFieldId = fieldId.replace(/[^a-zA-Z0-9_-]/g, '');
      whereClause += ` AND data->>'${sanitizedFieldId}' = $${paramIdx}`;
      params.push(value);
      paramIdx++;
    }
  }

  // Sort
  let orderClause = 'ORDER BY updated_at DESC, id DESC';
  if (options.sortBy) {
    const parts = options.sortBy.split(',').map((s) => s.trim()).filter(Boolean);
    const orderParts: string[] = [];
    for (const part of parts) {
      const [field, dir] = part.split(':');
      const direction = dir?.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
      const sanitizedField = field.replace(/[^a-zA-Z0-9_-]/g, '');
      orderParts.push(`data->>'${sanitizedField}' ${direction}`);
    }
    if (orderParts.length > 0) {
      orderClause = `ORDER BY ${orderParts.join(', ')}`;
    }
  }

  params.push(limit);
  const query = `SELECT * FROM records ${whereClause} ${orderClause} LIMIT $${paramIdx}`;

  const result = await pool.query(query, params);
  const records = result.rows as DataRecord[];

  let nextCursor: string | null = null;
  if (records.length === limit) {
    const last = records[records.length - 1];
    nextCursor = encodeCursor(last.id, new Date(last.updated_at));
  }

  return { records, nextCursor };
}

// ---------------------------------------------------------------------------
// createRecord
// ---------------------------------------------------------------------------

export async function createRecord(
  tenantId: string,
  data: Record<string, unknown>,
  actorUserId?: string,
): Promise<DataRecord> {
  const schema = await getSchema(tenantId);
  const validationResults = validateRecordData(schema, data);
  const invalid = validationResults.filter((r) => !r.valid);
  if (invalid.length > 0) {
    const first = invalid[0];
    throw new ValidationError(first.error ?? 'Validation failed', first.field_id, 'constraint');
  }

  const result = await pool.query(
    `INSERT INTO records (tenant_id, data) VALUES ($1, $2) RETURNING *`,
    [tenantId, JSON.stringify(data)],
  );
  const record = result.rows[0] as DataRecord;

  await writeAuditLog(tenantId, actorUserId ?? SYSTEM_ACTOR, record.id, 'create', undefined, JSON.stringify(data));

  return record;
}

// ---------------------------------------------------------------------------
// updateRecord
// ---------------------------------------------------------------------------

export async function updateRecord(
  tenantId: string,
  recordId: string,
  data: Record<string, unknown>,
  version: number,
  actorUserId?: string,
): Promise<DataRecord> {
  const schema = await getSchema(tenantId);
  const validationResults = validateRecordData(schema, data);
  const invalid = validationResults.filter((r) => !r.valid);
  if (invalid.length > 0) {
    const first = invalid[0];
    throw new ValidationError(first.error ?? 'Validation failed', first.field_id, 'constraint');
  }

  // Fetch old data for audit log
  const oldResult = await pool.query(
    `SELECT data FROM records WHERE id = $1 AND tenant_id = $2 AND is_deleted = false`,
    [recordId, tenantId],
  );
  const oldData = oldResult.rows[0]?.data;

  const result = await pool.query(
    `UPDATE records
     SET data = $1, version = version + 1, updated_at = now()
     WHERE id = $2 AND tenant_id = $3 AND version = $4 AND is_deleted = false
     RETURNING *`,
    [JSON.stringify(data), recordId, tenantId, version],
  );

  if (result.rowCount === 0) {
    // Check if record exists (concurrency vs not found)
    const exists = await pool.query(
      `SELECT id FROM records WHERE id = $1 AND tenant_id = $2 AND is_deleted = false`,
      [recordId, tenantId],
    );
    if (exists.rows.length > 0) {
      throw new ConcurrencyError();
    }
    throw new NotFoundError(`Record ${recordId} not found`);
  }

  const updated = result.rows[0] as DataRecord;
  await writeAuditLog(
    tenantId,
    actorUserId ?? SYSTEM_ACTOR,
    recordId,
    'update',
    JSON.stringify(oldData),
    JSON.stringify(data),
  );

  return updated;
}

// ---------------------------------------------------------------------------
// deleteRecord
// ---------------------------------------------------------------------------

export async function deleteRecord(
  tenantId: string,
  recordId: string,
  actorUserId?: string,
): Promise<void> {
  const result = await pool.query(
    `UPDATE records SET is_deleted = true, deleted_at = now()
     WHERE id = $1 AND tenant_id = $2 AND is_deleted = false`,
    [recordId, tenantId],
  );

  if (result.rowCount === 0) {
    throw new NotFoundError(`Record ${recordId} not found`);
  }

  await writeAuditLog(tenantId, actorUserId ?? SYSTEM_ACTOR, recordId, 'delete');
}

// ---------------------------------------------------------------------------
// bulkUpdateRecords
// ---------------------------------------------------------------------------

export async function bulkUpdateRecords(
  tenantId: string,
  recordIds: string[],
  fieldId: string,
  value: unknown,
  actorUserId?: string,
): Promise<{ updated: number }> {
  const sanitizedBulkFieldId = fieldId.replace(/[^a-zA-Z0-9_-]/g, '');
  const result = await pool.query(
    `UPDATE records
     SET data = jsonb_set(data, $1::text[], $2::jsonb), version = version + 1, updated_at = now()
     WHERE id = ANY($3::uuid[]) AND tenant_id = $4 AND is_deleted = false
     RETURNING id`,
    [`{${sanitizedBulkFieldId}}`, JSON.stringify(value), recordIds, tenantId],
  );

  const updatedIds: string[] = result.rows.map((r: { id: string }) => r.id);

  // Write individual audit log entries
  for (const id of updatedIds) {
    await writeAuditLog(tenantId, actorUserId ?? SYSTEM_ACTOR, id, 'update', undefined, JSON.stringify({ [fieldId]: value }));
  }

  return { updated: result.rowCount ?? 0 };
}

// ---------------------------------------------------------------------------
// bulkDeleteRecords
// ---------------------------------------------------------------------------

export async function bulkDeleteRecords(
  tenantId: string,
  recordIds: string[],
  actorUserId?: string,
): Promise<{ deleted: number }> {
  const result = await pool.query(
    `UPDATE records SET is_deleted = true, deleted_at = now()
     WHERE id = ANY($1::uuid[]) AND tenant_id = $2 AND is_deleted = false
     RETURNING id`,
    [recordIds, tenantId],
  );

  const deletedIds: string[] = result.rows.map((r: { id: string }) => r.id);

  for (const id of deletedIds) {
    await writeAuditLog(tenantId, actorUserId ?? SYSTEM_ACTOR, id, 'delete');
  }

  return { deleted: result.rowCount ?? 0 };
}

// ---------------------------------------------------------------------------
// restoreRecord
// ---------------------------------------------------------------------------

export async function restoreRecord(
  tenantId: string,
  recordId: string,
  actorUserId?: string,
): Promise<DataRecord> {
  const result = await pool.query(
    `UPDATE records SET is_deleted = false, deleted_at = null
     WHERE id = $1 AND tenant_id = $2 AND is_deleted = true
       AND deleted_at > now() - interval '30 days'
     RETURNING *`,
    [recordId, tenantId],
  );

  if (result.rowCount === 0) {
    throw new NotFoundError(`Record ${recordId} not found or outside 30-day restore window`);
  }

  const record = result.rows[0] as DataRecord;
  await writeAuditLog(tenantId, actorUserId ?? SYSTEM_ACTOR, recordId, 'restore');

  return record;
}
