import { pool } from '../db/pool';

export type TenantSummary = {
  id: string;
  name: string;
  slug: string;
  created_at: Date;
  deleted_at: Date | null;
  record_count: number;
};

export type HealthStats = {
  pgPoolTotal: number;
  pgPoolIdle: number;
  pgPoolWaiting: number;
  timestamp: string;
};

export async function listTenants(): Promise<TenantSummary[]> {
  const result = await pool.query<TenantSummary>(`
    SELECT tenants.id, tenants.name, tenants.slug, tenants.created_at, tenants.deleted_at,
           COUNT(records.id)::int AS record_count
    FROM tenants
    LEFT JOIN records ON records.tenant_id = tenants.id AND records.is_deleted = false
    GROUP BY tenants.id
    ORDER BY tenants.created_at DESC
  `);
  return result.rows;
}

export async function suspendTenant(tenantId: string): Promise<void> {
  await pool.query(`UPDATE tenants SET deleted_at = now() WHERE id = $1`, [tenantId]);
}

export async function activateTenant(tenantId: string): Promise<void> {
  await pool.query(`UPDATE tenants SET deleted_at = NULL WHERE id = $1`, [tenantId]);
}

export function getHealthStats(): HealthStats {
  return {
    pgPoolTotal: pool.totalCount,
    pgPoolIdle: pool.idleCount,
    pgPoolWaiting: pool.waitingCount,
    timestamp: new Date().toISOString(),
  };
}

export async function triggerBackup(): Promise<{ jobId: string }> {
  // Backup worker will be wired in Task 12; return a mock job ID for now
  return { jobId: 'backup-' + Date.now() };
}
