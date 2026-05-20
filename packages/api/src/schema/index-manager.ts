/**
 * IndexManager — B-tree functional indexes for JSONB field sorting/filtering
 * Feature: universal-data-calibration-platform
 */
import { Pool } from 'pg';
import type { FieldType } from './schema.service';

// ---------------------------------------------------------------------------
// getIndexName
// ---------------------------------------------------------------------------

export function getIndexName(fieldId: string): string {
  return 'idx_records_field_' + fieldId.replace(/-/g, '').slice(0, 16);
}

// ---------------------------------------------------------------------------
// createFunctionalIndex
// ---------------------------------------------------------------------------

export async function createFunctionalIndex(
  pool: Pool,
  tenantId: string,
  fieldId: string,
  fieldType: FieldType,
): Promise<void> {
  const indexName = getIndexName(fieldId);

  let castExpr: string;
  if (fieldType === 'integer' || fieldType === 'float') {
    castExpr = `(cast(data->>'${fieldId}' AS numeric))`;
  } else if (fieldType === 'date') {
    castExpr = `(cast(data->>'${fieldId}' AS date))`;
  } else {
    // text / status
    castExpr = `(cast(data->>'${fieldId}' AS text))`;
  }

  // CONCURRENTLY cannot run inside a transaction — use pool.query directly
  await pool.query(
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${indexName}
     ON records (${castExpr})
     WHERE is_deleted = false AND tenant_id = '${tenantId}'`,
  );
}

// ---------------------------------------------------------------------------
// dropFunctionalIndex
// ---------------------------------------------------------------------------

export async function dropFunctionalIndex(pool: Pool, fieldId: string): Promise<void> {
  const indexName = getIndexName(fieldId);
  await pool.query(`DROP INDEX CONCURRENTLY IF EXISTS ${indexName}`);
}
