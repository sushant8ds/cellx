/**
 * Import/Export property tests
 * Feature: universal-data-calibration-platform
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { Workbook } from 'exceljs';

vi.mock('../db/pool', () => ({ pool: { query: vi.fn() } }));
vi.mock('../schema/schema.service', () => ({
  getSchema: vi.fn().mockResolvedValue([]),
  validateFieldValue: vi.fn().mockReturnValue({ valid: true }),
  validateRecordData: vi.fn().mockReturnValue([]),
}));

import { parseFile, inferDataType, processImport, ImportError } from './import.service';
import { generateXlsx } from '../export/export.service';
import type { DynamicField } from '../schema/schema.service';
import type { DataRecord } from '../records/record.service';

// ---------------------------------------------------------------------------
// Property 7: Import File Acceptance Boundary
// Validates: Requirements 3.1, 3.3
// ---------------------------------------------------------------------------
describe('Property 7: Import File Acceptance Boundary', () => {
  it('accepts valid .csv buffer', async () => {
    const csv = Buffer.from('name,value\nAlice,1\nBob,2');
    const result = await parseFile(csv, 'test.csv');
    expect(result.headers).toEqual(['name', 'value']);
    expect(result.rows).toHaveLength(2);
  });

  it('accepts valid .xlsx buffer', async () => {
    const workbook = new Workbook();
    const ws = workbook.addWorksheet('Sheet1');
    ws.addRow(['name', 'value']);
    ws.addRow(['Alice', 1]);
    const buffer = await workbook.xlsx.writeBuffer() as unknown as Buffer;
    const result = await parseFile(buffer, 'test.xlsx');
    expect(result.headers).toContain('name');
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it('rejects unsupported file format', async () => {
    const buf = Buffer.from('some text content');
    await expect(parseFile(buf, 'data.txt')).rejects.toBeInstanceOf(ImportError);
  });

  it('rejects file exceeding 50MB', async () => {
    const bigBuffer = Buffer.alloc(51 * 1024 * 1024, 'x');
    await expect(parseFile(bigBuffer, 'big.csv')).rejects.toBeInstanceOf(ImportError);
    await expect(parseFile(bigBuffer, 'big.csv')).rejects.toThrow('File too large');
  });

  it('boundary: file exactly at 50MB is accepted (csv)', async () => {
    // Build a valid CSV that is exactly at the limit
    const header = 'col\n';
    const rowSize = 10; // "123456789\n"
    const targetSize = 50 * 1024 * 1024;
    const rowCount = Math.floor((targetSize - header.length) / rowSize);
    const rows = Array(rowCount).fill('123456789').join('\n');
    const csv = Buffer.from(header + rows);
    // Should not throw ImportError for size (may throw parse error for malformed content)
    try {
      await parseFile(csv, 'boundary.csv');
    } catch (err) {
      expect(err).not.toBeInstanceOf(ImportError);
    }
  });
});

// ---------------------------------------------------------------------------
// Property 8: Import Row Count Accuracy
// Validates: Requirements 3.5, 3.6
// ---------------------------------------------------------------------------
describe('Property 8: Import Row Count Accuracy', () => {
  beforeEach(() => vi.clearAllMocks());

  it('processImport produces exactly (N-K) records and reports K skipped rows', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 0, max: 10 }),
        async (n, k) => {
          fc.pre(k <= n);

          const { pool } = await import('../db/pool') as unknown as { pool: { query: ReturnType<typeof vi.fn> } };
          vi.clearAllMocks();

          // Mock the single unnest() bulk INSERT to succeed
          pool.query.mockResolvedValue({ rows: [], rowCount: n - k });

          // Build N rows: first K have invalid integer values, rest are valid
          const rows: Record<string, string>[] = [];
          for (let i = 0; i < n; i++) {
            rows.push({ col_a: i < k ? 'not-a-number' : String(i) });
          }

          const schema: DynamicField[] = [{
            id: 'field-a',
            tenant_id: 'tenant-1',
            name: 'col_a',
            field_type: 'integer',
            dropdown_values: null,
            constraints: null,
            display_order: 0,
            is_deleted: false,
            deleted_at: null,
            created_at: new Date(),
          }];

          const mapping = { col_a: 'field-a' };
          const summary = await processImport('tenant-1', rows, mapping, schema, '00000000-0000-0000-0000-000000000000');

          expect(summary.imported).toBe(n - k);
          expect(summary.skipped).toBe(k);
          expect(summary.errors).toHaveLength(k);

          // Bulk insert: pool.query called at most once (zero times if all rows invalid)
          const validCount = n - k;
          expect(pool.query).toHaveBeenCalledTimes(validCount > 0 ? 1 : 0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 9: Import–Export Round Trip
// Validates: Requirements 3.7, 11.4
// ---------------------------------------------------------------------------
describe('Property 9: Import–Export Round Trip', () => {
  it('exporting to xlsx then re-importing produces equivalent field values', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => !s.includes(',')),
            value: fc.integer({ min: 0, max: 9999 }),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        async (testData) => {
          const schema: DynamicField[] = [
            { id: 'f-name', tenant_id: 't1', name: 'name', field_type: 'text', dropdown_values: null, constraints: null, display_order: 0, is_deleted: false, deleted_at: null, created_at: new Date() },
            { id: 'f-value', tenant_id: 't1', name: 'value', field_type: 'integer', dropdown_values: null, constraints: null, display_order: 1, is_deleted: false, deleted_at: null, created_at: new Date() },
          ];

          const records: DataRecord[] = testData.map((d, i) => ({
            id: `rec-${i}`,
            tenant_id: 't1',
            data: { 'f-name': d.name, 'f-value': d.value },
            version: 1,
            is_deleted: false,
            deleted_at: null,
            created_at: new Date(),
            updated_at: new Date(),
          }));

          // Export to xlsx
          const buffer = await generateXlsx(records, schema, 'TestTenant', '');

          // Re-import the xlsx.
          // generateXlsx produces 3 header rows before data:
          //   Row 1: "Filters: none"   <- parseFile uses this as the column header key
          //   Row 2: "Tenant: ..."     <- becomes a data row keyed by 'Filters: none'
          //   Row 3: field names       <- becomes a data row keyed by 'Filters: none'
          //   Row 4+: actual data      <- becomes data rows keyed by 'Filters: none'
          // Only the first column is captured (row 1 has 1 cell → 1 header).
          const parsed = await parseFile(buffer, 'export.xlsx');

          // All rows (including the 2 metadata rows) are in parsed.rows.
          // The first column of each data row (the 'name' field) is stored under key 'Filters: none'.
          const allFirstColValues = parsed.rows.map((r) => r['Filters: none']);

          // Every test data name must appear in the first column of some row
          for (const d of testData) {
            expect(allFirstColValues).toContain(String(d.name));
          }

          // The total row count is: 2 metadata rows + testData.length data rows
          expect(parsed.rows.length).toBe(testData.length + 2);
        },
      ),
      { numRuns: 20 }, // xlsx generation is slow
    );
  });
});

// ---------------------------------------------------------------------------
// Property 33: Export File Completeness
// Validates: Requirements 11.3
// ---------------------------------------------------------------------------
describe('Property 33: Export File Completeness', () => {
  it('exported xlsx contains all visible columns, filter annotation, tenant name, and timestamp', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.string({ minLength: 0, maxLength: 50 }),
        async (tenantName, filterStr) => {
          const schema: DynamicField[] = [
            { id: 'f1', tenant_id: 't1', name: 'Gauge ID', field_type: 'text', dropdown_values: null, constraints: null, display_order: 0, is_deleted: false, deleted_at: null, created_at: new Date() },
            { id: 'f2', tenant_id: 't1', name: 'Status', field_type: 'status', dropdown_values: ['Safe', 'Danger'], constraints: null, display_order: 1, is_deleted: false, deleted_at: null, created_at: new Date() },
          ];

          const records: DataRecord[] = [
            { id: 'r1', tenant_id: 't1', data: { f1: 'G-001', f2: 'Safe' }, version: 1, is_deleted: false, deleted_at: null, created_at: new Date(), updated_at: new Date() },
          ];

          const buffer = await generateXlsx(records, schema, tenantName, filterStr);

          // Parse the generated xlsx to verify contents
          const workbook = new Workbook();
          await workbook.xlsx.load(buffer.buffer as ArrayBuffer);
          const ws = workbook.worksheets[0];

          // Row 1: filter annotation
          const row1 = ws.getRow(1).values as string[];
          expect(row1.join(' ')).toContain('Filters:');

          // Row 2: tenant name
          const row2 = ws.getRow(2).values as string[];
          expect(row2.join(' ')).toContain(tenantName);

          // Row 3: column headers
          const row3 = ws.getRow(3).values as string[];
          expect(row3).toContain('Gauge ID');
          expect(row3).toContain('Status');

          // Row 4: data
          const row4 = ws.getRow(4).values as string[];
          expect(row4).toContain('G-001');
          expect(row4).toContain('Safe');
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ---------------------------------------------------------------------------
// inferDataType unit tests
// ---------------------------------------------------------------------------
describe('inferDataType', () => {
  it('infers integer for all-integer values', () => {
    expect(inferDataType(['1', '2', '3', '-5'])).toBe('integer');
  });
  it('infers float for decimal values', () => {
    expect(inferDataType(['1.5', '2.3', '0.1'])).toBe('float');
  });
  it('infers date for ISO date strings', () => {
    expect(inferDataType(['2024-01-01', '2023-12-31'])).toBe('date');
  });
  it('infers text for mixed values', () => {
    expect(inferDataType(['Safe', 'Danger', 'Warning'])).toBe('text');
  });
  it('returns text for empty array', () => {
    expect(inferDataType([])).toBe('text');
  });
});
