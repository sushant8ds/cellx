/**
 * Record property tests
 * Feature: universal-data-calibration-platform
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

// Mock pool before importing anything that uses it
vi.mock('../db/pool', () => ({
  pool: {
    query: vi.fn(),
  },
}));

// Mock schema service to avoid DB calls in record service
vi.mock('../schema/schema.service', () => ({
  getSchema: vi.fn().mockResolvedValue([]),
  validateRecordData: vi.fn().mockReturnValue([]),
}));

import {
  listRecords,
  createRecord,
  updateRecord,
  deleteRecord,
  bulkUpdateRecords,
  bulkDeleteRecords,
  restoreRecord,
  ConcurrencyError,
  NotFoundError,
  type DataRecord,
} from './record.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<DataRecord> = {}): DataRecord {
  return {
    id: 'record-uuid-1',
    tenant_id: 'tenant-uuid-1',
    data: {},
    version: 1,
    is_deleted: false,
    deleted_at: null,
    created_at: new Date('2024-01-01'),
    updated_at: new Date('2024-01-01'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Property 25: Filter Correctness
// Validates: Requirements 8.2, 8.3
// ---------------------------------------------------------------------------
describe('Property 25: Filter Correctness', () => {
  beforeEach(() => vi.clearAllMocks());

  it('SQL WHERE clause contains the correct filter for each filter[fieldId]=value', async () => {
    /**
     * **Validates: Requirements 8.2, 8.3**
     * For any filter condition on a field, the generated SQL WHERE clause must
     * contain the correct filter predicate so only matching records are returned.
     */
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          fieldId: fc.uuid(),
          value: fc.string({ minLength: 1, maxLength: 30 }).filter((s) => !s.includes("'")),
        }),
        fc.uuid(),
        async ({ fieldId, value }, tenantId) => {
          const { pool } = await import('../db/pool') as unknown as { pool: { query: ReturnType<typeof vi.fn> } };
          vi.clearAllMocks();

          const matchingRecord = makeRecord({ tenant_id: tenantId, data: { [fieldId]: value } });
          pool.query.mockResolvedValueOnce({ rows: [matchingRecord], rowCount: 1 });

          const result = await listRecords(tenantId, { filters: { [fieldId]: value } });

          // The query was called
          expect(pool.query).toHaveBeenCalledOnce();
          const [sql, params] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];

          // With parameterized ->> the field ID is a bind parameter, not in the SQL string.
          // Verify it appears in the params array and the SQL uses the ->> operator.
          expect(sql).toContain('->>');
          expect(params).toContain(fieldId);
          // The value must appear in the params array
          expect(params).toContain(value);

          // All returned records satisfy the filter (mocked to return matching record)
          expect(result.records).toHaveLength(1);
          expect((result.records[0].data as Record<string, unknown>)[fieldId]).toBe(value);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 26: Multi-Column Sort Correctness
// Validates: Requirements 8.4
// ---------------------------------------------------------------------------
describe('Property 26: Multi-Column Sort Correctness', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ORDER BY clause in generated SQL matches the sortBy spec', async () => {
    /**
     * **Validates: Requirements 8.4**
     * For any sort spec "field1:asc,field2:desc", the ORDER BY clause in the
     * generated SQL must match the spec's column priority and direction.
     */
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            field: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => /^[a-z_]+$/.test(s)),
            dir: fc.constantFrom('asc', 'desc'),
          }),
          { minLength: 1, maxLength: 4 },
        ),
        fc.uuid(),
        async (sortParts, tenantId) => {
          const { pool } = await import('../db/pool') as unknown as { pool: { query: ReturnType<typeof vi.fn> } };
          vi.clearAllMocks();

          const sortBy = sortParts.map((p) => `${p.field}:${p.dir}`).join(',');
          pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

          await listRecords(tenantId, { sortBy });

          const [sql, params] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];

          // With parameterized ->>, field names are bind parameters not in the SQL string.
          // Verify the SQL uses ->> and each field/direction appears in params or SQL.
          expect(sql).toContain('->>');
          for (const { field, dir } of sortParts) {
            // Field name is a bind parameter
            expect(params).toContain(field);
            // Direction is safe to interpolate (validated to ASC/DESC only)
            expect(sql.toUpperCase()).toContain(dir.toUpperCase());
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 27: Inline Edit Atomicity
// Validates: Requirements 8.5
// ---------------------------------------------------------------------------
describe('Property 27: Inline Edit Atomicity', () => {
  beforeEach(() => vi.clearAllMocks());

  it('if UPDATE fails, no audit log entry is written', async () => {
    /**
     * **Validates: Requirements 8.5**
     * If the UPDATE query fails, no audit log INSERT should be called.
     */
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        fc.record({ name: fc.string() }),
        fc.integer({ min: 1, max: 100 }),
        async (tenantId, recordId, data, version) => {
          const { pool } = await import('../db/pool') as unknown as { pool: { query: ReturnType<typeof vi.fn> } };
          vi.clearAllMocks();

          const dbError = new Error('DB connection lost');

          // getSchema (mocked), then SELECT old data, then UPDATE throws
          pool.query
            .mockResolvedValueOnce({ rows: [{ data: {} }], rowCount: 1 }) // SELECT old data
            .mockRejectedValueOnce(dbError);                               // UPDATE fails

          await expect(updateRecord(tenantId, recordId, data, version)).rejects.toThrow('DB connection lost');

          // Audit log INSERT should NOT have been called
          const auditCalls = (pool.query as ReturnType<typeof vi.fn>).mock.calls.filter(
            (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO audit_log'),
          );
          expect(auditCalls).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('if UPDATE succeeds, an audit log entry IS written', async () => {
    /**
     * **Validates: Requirements 8.5**
     * If the UPDATE succeeds, exactly one audit log INSERT must be called.
     */
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        fc.record({ name: fc.string() }),
        fc.integer({ min: 1, max: 100 }),
        async (tenantId, recordId, data, version) => {
          const { pool } = await import('../db/pool') as unknown as { pool: { query: ReturnType<typeof vi.fn> } };
          vi.clearAllMocks();

          const updatedRecord = makeRecord({ id: recordId, tenant_id: tenantId, data, version: version + 1 });

          pool.query
            .mockResolvedValueOnce({ rows: [{ data: {} }], rowCount: 1 }) // SELECT old data
            .mockResolvedValueOnce({ rows: [updatedRecord], rowCount: 1 }) // UPDATE succeeds
            .mockResolvedValueOnce({ rows: [], rowCount: 1 });             // audit log INSERT

          await updateRecord(tenantId, recordId, data, version);

          const auditCalls = (pool.query as ReturnType<typeof vi.fn>).mock.calls.filter(
            (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO audit_log'),
          );
          expect(auditCalls).toHaveLength(1);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 28: Optimistic Concurrency Control
// Validates: Requirements 8.7
// ---------------------------------------------------------------------------
describe('Property 28: Optimistic Concurrency Control', () => {
  beforeEach(() => vi.clearAllMocks());

  it('second concurrent update with same version throws ConcurrencyError', async () => {
    /**
     * **Validates: Requirements 8.7**
     * For any record with version V, two concurrent updates both with version V:
     * exactly one succeeds (rowCount=1), the other gets ConcurrencyError.
     */
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        fc.integer({ min: 1, max: 100 }),
        async (tenantId, recordId, version) => {
          const { pool } = await import('../db/pool') as unknown as { pool: { query: ReturnType<typeof vi.fn> } };
          vi.clearAllMocks();

          const successRecord = makeRecord({ id: recordId, tenant_id: tenantId, version: version + 1 });

          // First update: succeeds
          pool.query
            .mockResolvedValueOnce({ rows: [{ data: {} }], rowCount: 1 }) // SELECT old data
            .mockResolvedValueOnce({ rows: [successRecord], rowCount: 1 }) // UPDATE succeeds
            .mockResolvedValueOnce({ rows: [], rowCount: 1 });             // audit log

          const first = await updateRecord(tenantId, recordId, {}, version);
          expect(first.version).toBe(version + 1);

          vi.clearAllMocks();

          // Second update with same version: UPDATE returns rowCount=0, record exists
          pool.query
            .mockResolvedValueOnce({ rows: [{ data: {} }], rowCount: 1 }) // SELECT old data
            .mockResolvedValueOnce({ rows: [], rowCount: 0 })              // UPDATE returns 0 (version mismatch)
            .mockResolvedValueOnce({ rows: [{ id: recordId }], rowCount: 1 }); // EXISTS check

          await expect(updateRecord(tenantId, recordId, {}, version)).rejects.toBeInstanceOf(ConcurrencyError);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 14: Soft Delete Retention
// Validates: Requirements 4.7, 8.8
// ---------------------------------------------------------------------------
describe('Property 14: Soft Delete Retention', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deleteRecord sets is_deleted=true and record is excluded from normal listRecords', async () => {
    /**
     * **Validates: Requirements 4.7, 8.8**
     * For any deleted record, is_deleted=true but data remains in DB.
     * The record is NOT returned by listRecords (is_deleted=false filter).
     * The record IS returned by listRecords with archived=true.
     */
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        async (tenantId, recordId) => {
          const { pool } = await import('../db/pool') as unknown as { pool: { query: ReturnType<typeof vi.fn> } };
          vi.clearAllMocks();

          // deleteRecord: UPDATE sets is_deleted=true, then audit log
          pool.query
            .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE is_deleted=true
            .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // audit log

          await deleteRecord(tenantId, recordId);

          // Verify the UPDATE SQL sets is_deleted=true
          const updateCall = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
          expect(updateCall[0]).toContain('is_deleted = true');

          vi.clearAllMocks();

          // Normal listRecords: WHERE is_deleted=false → returns empty (record excluded)
          pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
          const normal = await listRecords(tenantId, { archived: false });
          const [normalSql] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
          expect(normalSql).toContain('is_deleted = false');
          expect(normal.records).toHaveLength(0);

          vi.clearAllMocks();

          // Archived listRecords: WHERE is_deleted=true → returns the deleted record
          const deletedRecord = makeRecord({ id: recordId, tenant_id: tenantId, is_deleted: true });
          pool.query.mockResolvedValueOnce({ rows: [deletedRecord], rowCount: 1 });
          const archived = await listRecords(tenantId, { archived: true });
          const [archivedSql] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
          expect(archivedSql).toContain('is_deleted = true');
          expect(archived.records).toHaveLength(1);
          expect(archived.records[0].is_deleted).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 15: Soft Delete Restore Round-Trip
// Validates: Requirements 4.8, 8.9
// ---------------------------------------------------------------------------
describe('Property 15: Soft Delete Restore Round-Trip', () => {
  beforeEach(() => vi.clearAllMocks());

  it('restoreRecord returns record with is_deleted=false and original data intact', async () => {
    /**
     * **Validates: Requirements 4.8, 8.9**
     * For any soft-deleted record within 30 days, restoreRecord returns it to
     * active status with all original data intact.
     */
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        fc.record({
          name: fc.string({ minLength: 1, maxLength: 30 }),
          value: fc.integer({ min: 0, max: 9999 }),
        }),
        async (tenantId, recordId, originalData) => {
          const { pool } = await import('../db/pool') as unknown as { pool: { query: ReturnType<typeof vi.fn> } };
          vi.clearAllMocks();

          const restoredRecord = makeRecord({
            id: recordId,
            tenant_id: tenantId,
            data: originalData as Record<string, unknown>,
            is_deleted: false,
            deleted_at: null,
          });

          pool.query
            .mockResolvedValueOnce({ rows: [restoredRecord], rowCount: 1 }) // UPDATE restore
            .mockResolvedValueOnce({ rows: [], rowCount: 1 });               // audit log

          const result = await restoreRecord(tenantId, recordId);

          // Returned record has is_deleted=false
          expect(result.is_deleted).toBe(false);
          expect(result.deleted_at).toBeNull();

          // Original data is intact
          expect(result.data).toEqual(originalData);

          // Verify the UPDATE SQL sets is_deleted=false
          const updateCall = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
          expect(updateCall[0]).toContain('is_deleted = false');
          expect(updateCall[0]).toContain('30 days');
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 29: Bulk Update Atomicity
// Validates: Requirements 8.11
// ---------------------------------------------------------------------------
describe('Property 29: Bulk Update Atomicity', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns { updated: 0 } when the UPDATE query fails', async () => {
    /**
     * **Validates: Requirements 8.11**
     * For any bulk update targeting N records, either all N are updated or none.
     * When the transaction fails, { updated: 0 } is returned (or error thrown).
     */
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.array(fc.uuid(), { minLength: 1, maxLength: 10 }),
        fc.uuid(),
        fc.string(),
        async (tenantId, recordIds, fieldId, value) => {
          const { pool } = await import('../db/pool') as unknown as { pool: { query: ReturnType<typeof vi.fn> } };
          vi.clearAllMocks();

          const dbError = new Error('Transaction rolled back');
          pool.query.mockRejectedValueOnce(dbError);

          await expect(bulkUpdateRecords(tenantId, recordIds, fieldId, value)).rejects.toThrow(
            'Transaction rolled back',
          );

          // No audit log entries should have been written
          const auditCalls = (pool.query as ReturnType<typeof vi.fn>).mock.calls.filter(
            (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO audit_log'),
          );
          expect(auditCalls).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 30: Bulk Update Audit Log Completeness
// Validates: Requirements 8.12
// ---------------------------------------------------------------------------
describe('Property 30: Bulk Update Audit Log Completeness', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exactly N audit log entries are written when N records are updated', async () => {
    /**
     * **Validates: Requirements 8.12**
     * For any bulk update that successfully updates N records,
     * exactly N individual audit log entries are written.
     */
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.array(fc.uuid(), { minLength: 1, maxLength: 10 }),
        fc.uuid(),
        fc.string(),
        async (tenantId, recordIds, fieldId, value) => {
          const { pool } = await import('../db/pool') as unknown as { pool: { query: ReturnType<typeof vi.fn> } };
          vi.clearAllMocks();

          const n = recordIds.length;

          // UPDATE returns N rows
          pool.query.mockResolvedValueOnce({
            rows: recordIds.map((id) => ({ id })),
            rowCount: n,
          });

          // N audit log INSERTs
          for (let i = 0; i < n; i++) {
            pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
          }

          const result = await bulkUpdateRecords(tenantId, recordIds, fieldId, value);

          expect(result.updated).toBe(n);

          // Total calls: 1 UPDATE + N audit log INSERTs
          expect(pool.query).toHaveBeenCalledTimes(n + 1);

          const auditCalls = (pool.query as ReturnType<typeof vi.fn>).mock.calls.filter(
            (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO audit_log'),
          );
          expect(auditCalls).toHaveLength(n);
        },
      ),
      { numRuns: 100 },
    );
  });
});
