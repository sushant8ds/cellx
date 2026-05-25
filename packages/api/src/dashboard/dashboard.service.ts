/**
 * DashboardService — compute widget counts from active records
 * Feature: universal-data-calibration-platform
 */
import { pool } from '../db/pool';
import { DashboardCounts, publishDashboardUpdate } from './sse.service';

// Status field values that map to dashboard categories
const STATUS_MAP: Record<string, keyof Omit<DashboardCounts, 'total'>> = {
  safe: 'safe',
  Safe: 'safe',
  SAFE: 'safe',
  warning: 'warning',
  Warning: 'warning',
  'Near Limit': 'warning',
  'near limit': 'warning',
  danger: 'danger',
  Danger: 'danger',
  DANGER: 'danger',
  overdue: 'overdue',
  Overdue: 'overdue',
  OVERDUE: 'overdue',
  'Calibration Required': 'overdue',
};

export async function getDashboardCounts(tenantId: string): Promise<DashboardCounts> {
  // Aggregate status counts in the database using GROUP BY.
  // jsonb_each_text expands every key/value in the data JSONB column so we can
  // match status-like values without pulling rows into Node.js memory.
  const result = await pool.query<{ status_val: string; cnt: string }>(
    `SELECT kv.value AS status_val, COUNT(*) AS cnt
     FROM records r,
          LATERAL jsonb_each_text(r.data) AS kv(key, value)
     WHERE r.tenant_id = $1
       AND r.is_deleted = false
       AND kv.value = ANY($2::text[])
     GROUP BY kv.value`,
    [tenantId, Object.keys(STATUS_MAP)],
  );

  const counts: DashboardCounts = { safe: 0, warning: 0, danger: 0, overdue: 0, total: 0 };

  for (const row of result.rows) {
    const category = STATUS_MAP[row.status_val];
    if (category) counts[category] += parseInt(row.cnt, 10);
  }

  // Total is a separate lightweight COUNT — avoids double-counting records
  // that might have multiple status-like values in different fields.
  const totalResult = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt FROM records WHERE tenant_id = $1 AND is_deleted = false`,
    [tenantId],
  );
  counts.total = parseInt(totalResult.rows[0].cnt, 10);

  return counts;
}

// Called after any record mutation that may change status counts
// Recomputes counts and broadcasts to all connected SSE clients
export async function refreshDashboard(tenantId: string): Promise<void> {
  try {
    const counts = await getDashboardCounts(tenantId);
    publishDashboardUpdate(tenantId, counts);
  } catch (err) {
    // Non-fatal — dashboard refresh failure should not block the mutation
  }
}
