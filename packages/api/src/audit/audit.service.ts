/**
 * AuditService — append-only audit log reads and writes
 * Feature: universal-data-calibration-platform
 *
 * The audit_log table has no UPDATE/DELETE permissions at DB level (enforced in migration).
 * This service provides the READ interface and the single canonical WRITE path.
 */
import { pool } from '../db/pool';

export interface AuditLogEntry {
  id: number;
  tenant_id: string;
  actor_user_id: string;
  record_id: string | null;
  entity_type: string;
  action: string;
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  metadata: unknown;
  created_at: Date;
}

export interface QueryAuditLogOptions {
  dateFrom?: string;
  dateTo?: string;
  userId?: string;
  recordId?: string;
  entityType?: string;
  limit?: number;
  cursor?: string;
}

export interface AuditLogResult {
  entries: AuditLogEntry[];
  nextCursor: string | null;
}

export async function queryAuditLog(
  tenantId: string,
  options: QueryAuditLogOptions = {},
): Promise<AuditLogResult> {
  const limit = Math.min(options.limit ?? 100, 1000);
  const params: unknown[] = [tenantId];
  const conditions: string[] = ['tenant_id = $1'];

  if (options.dateFrom) {
    params.push(options.dateFrom);
    conditions.push(`created_at >= $${params.length}`);
  }
  if (options.dateTo) {
    params.push(options.dateTo);
    conditions.push(`created_at <= $${params.length}`);
  }
  if (options.userId) {
    params.push(options.userId);
    conditions.push(`actor_user_id = $${params.length}`);
  }
  if (options.recordId) {
    params.push(options.recordId);
    conditions.push(`record_id = $${params.length}`);
  }
  if (options.entityType) {
    params.push(options.entityType);
    conditions.push(`entity_type = $${params.length}`);
  }
  if (options.cursor) {
    const decoded = JSON.parse(Buffer.from(options.cursor, 'base64').toString('utf8')) as { id: number };
    params.push(decoded.id);
    conditions.push(`id < $${params.length}`);
  }

  params.push(limit + 1);
  const sql = `
    SELECT id, tenant_id, actor_user_id, record_id, entity_type, action,
           field_name, old_value, new_value, metadata, created_at
    FROM audit_log
    WHERE ${conditions.join(' AND ')}
    ORDER BY created_at DESC, id DESC
    LIMIT $${params.length}
  `;

  const result = await pool.query(sql, params);
  const rows: AuditLogEntry[] = result.rows;

  let nextCursor: string | null = null;
  if (rows.length > limit) {
    rows.pop();
    const last = rows[rows.length - 1];
    nextCursor = Buffer.from(JSON.stringify({ id: last.id })).toString('base64');
  }

  return { entries: rows, nextCursor };
}

export async function writeAuditEntry(
  entry: Omit<AuditLogEntry, 'id' | 'created_at'>,
): Promise<void> {
  await pool.query(
    `INSERT INTO audit_log
       (tenant_id, actor_user_id, record_id, entity_type, action,
        field_name, old_value, new_value, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      entry.tenant_id,
      entry.actor_user_id,
      entry.record_id ?? null,
      entry.entity_type,
      entry.action,
      entry.field_name ?? null,
      entry.old_value ?? null,
      entry.new_value ?? null,
      entry.metadata ?? null,
    ],
  );
}
