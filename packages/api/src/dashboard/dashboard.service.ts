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
  // Fetch all active records and count by status field value
  const result = await pool.query(
    `SELECT data FROM records WHERE tenant_id = $1 AND is_deleted = false`,
    [tenantId],
  );

  const counts: DashboardCounts = { safe: 0, warning: 0, danger: 0, overdue: 0, total: 0 };

  for (const row of result.rows as { data: Record<string, unknown> }[]) {
    counts.total++;
    // Look for any field with a status-like value
    for (const value of Object.values(row.data)) {
      const strVal = String(value ?? '');
      const category = STATUS_MAP[strVal];
      if (category) {
        counts[category]++;
        break; // count each record once
      }
    }
  }

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
