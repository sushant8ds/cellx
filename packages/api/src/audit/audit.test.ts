/**
 * Audit log property tests
 * Feature: universal-data-calibration-platform
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

vi.mock('../db/pool', () => ({
  pool: { query: vi.fn() },
}));

import { writeAuditEntry } from './audit.service';
import * as auditService from './audit.service';

// ---------------------------------------------------------------------------
// Property 23: Audit Log Completeness
// Validates: Requirements 7.1, 7.2, 6.6
// ---------------------------------------------------------------------------
describe('Property 23: Audit Log Completeness', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writeAuditEntry inserts all required fields as non-null params', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          tenantId: fc.uuid(),
          actorUserId: fc.uuid(),
          entityType: fc.constantFrom('record', 'schema', 'formula', 'alert_rule'),
          action: fc.constantFrom('create', 'update', 'delete'),
        }),
        fc.option(fc.uuid(), { nil: null }),
        fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
        fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
        async ({ tenantId, actorUserId, entityType, action }, recordId, oldValue, newValue) => {
          const { pool } = await import('../db/pool') as unknown as { pool: { query: ReturnType<typeof vi.fn> } };
          vi.clearAllMocks();
          pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

          await writeAuditEntry({
            tenant_id: tenantId,
            actor_user_id: actorUserId,
            record_id: recordId,
            entity_type: entityType,
            action,
            field_name: null,
            old_value: oldValue,
            new_value: newValue,
            metadata: null,
          });

          expect(pool.query).toHaveBeenCalledOnce();
          const [sql, params] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];

          expect(sql).toContain('INSERT INTO audit_log');
          expect(params).toContain(tenantId);
          expect(params).toContain(actorUserId);
          expect(params).toContain(entityType);
          expect(params).toContain(action);
          expect(params[2]).toBe(recordId);
          expect(params[6]).toBe(oldValue);
          expect(params[7]).toBe(newValue);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 24: Audit Log Immutability
// Validates: Requirements 7.3
// ---------------------------------------------------------------------------
describe('Property 24: Audit Log Immutability', () => {
  beforeEach(() => vi.clearAllMocks());

  it('AuditService does not export updateAuditEntry or deleteAuditEntry', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        (_entryId) => {
          const exportedKeys = Object.keys(auditService);
          expect(exportedKeys).not.toContain('updateAuditEntry');
          expect(exportedKeys).not.toContain('deleteAuditEntry');
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('a pg permission error (42501) on UPDATE propagates correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (entryId) => {
          const { pool } = await import('../db/pool') as unknown as { pool: { query: ReturnType<typeof vi.fn> } };
          vi.clearAllMocks();

          const pgPermissionError = Object.assign(
            new Error('permission denied for table audit_log'),
            { code: '42501' },
          );
          pool.query.mockRejectedValueOnce(pgPermissionError);

          await expect(
            pool.query(`UPDATE audit_log SET action = 'tampered' WHERE id = $1`, [entryId]),
          ).rejects.toMatchObject({ code: '42501' });
        },
      ),
      { numRuns: 100 },
    );
  });
});
