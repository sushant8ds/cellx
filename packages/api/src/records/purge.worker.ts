/**
 * Purge cron job: permanently delete soft-deleted items older than 30 days
 * Feature: universal-data-calibration-platform
 */
import { pool } from '../db/pool';

export async function runPurgeJob(): Promise<{ purgedRecords: number; purgedFields: number }> {
  // Permanently delete soft-deleted records older than 30 days
  const recordsResult = await pool.query(
    `DELETE FROM records
     WHERE is_deleted = true AND deleted_at < now() - interval '30 days'
     RETURNING id, tenant_id`,
  );

  // Permanently delete soft-deleted dynamic_fields older than 30 days
  const fieldsResult = await pool.query(
    `DELETE FROM dynamic_fields
     WHERE is_deleted = true AND deleted_at < now() - interval '30 days'
     RETURNING id, tenant_id`,
  );

  // Write audit log entries for purged records
  for (const row of recordsResult.rows as { id: string; tenant_id: string }[]) {
    await pool.query(
      `INSERT INTO audit_log
         (tenant_id, actor_user_id, record_id, entity_type, action)
       VALUES ($1, $2, $3, 'record', 'purge')`,
      [row.tenant_id, '00000000-0000-0000-0000-000000000000', row.id],
    );
  }

  // Write audit log entries for purged fields
  for (const row of fieldsResult.rows as { id: string; tenant_id: string }[]) {
    await pool.query(
      `INSERT INTO audit_log
         (tenant_id, actor_user_id, record_id, entity_type, action)
       VALUES ($1, $2, $3, 'schema', 'purge')`,
      [row.tenant_id, '00000000-0000-0000-0000-000000000000', row.id],
    );
  }

  return {
    purgedRecords: recordsResult.rowCount ?? 0,
    purgedFields: fieldsResult.rowCount ?? 0,
  };
}
