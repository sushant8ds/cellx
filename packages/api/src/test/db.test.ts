import { afterAll, describe, expect, it } from 'vitest';
import { closeTestDb, getTestDb } from './setup';

const TENANT_SCOPED_TABLES = [
  'records',
  'dynamic_fields',
  'formulas',
  'alert_rules',
  'audit_log',
  'api_keys',
  'notification_log',
  'background_jobs',
] as const;

const hasLiveDb = !!process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('test_placeholder');

describe('Task 1.1 — RLS smoke test', () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it.skipIf(!hasLiveDb)('pg_policies contains a tenant_isolation policy for all 8 tenant-scoped tables', async () => {
    const db = await getTestDb();

    const result = await db.query<{ tablename: string; policyname: string }>(
      `SELECT tablename, policyname
       FROM pg_policies
       WHERE schemaname = 'public'
         AND policyname = 'tenant_isolation'`,
    );

    const tablesWithPolicy = new Set(result.rows.map((r) => r.tablename));

    for (const table of TENANT_SCOPED_TABLES) {
      expect(
        tablesWithPolicy.has(table),
        `Expected RLS policy 'tenant_isolation' on table '${table}' but it was not found`,
      ).toBe(true);
    }
  });
});
