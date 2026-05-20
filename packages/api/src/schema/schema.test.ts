/**
 * Schema property tests
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

import {
  addField,
  getSchema,
  renameField,
  deleteField,
  validateFieldValue,
  validateRecordData,
  ConflictError,
  NotFoundError,
  type DynamicField,
  type FieldType,
} from './schema.service';

// ---------------------------------------------------------------------------
// Shared mock field factory
// ---------------------------------------------------------------------------

const mockField: DynamicField = {
  id: 'field-uuid-1',
  tenant_id: 'tenant-uuid-1',
  name: 'Test Field',
  field_type: 'text',
  dropdown_values: null,
  constraints: null,
  display_order: 0,
  is_deleted: false,
  deleted_at: null,
  created_at: new Date('2024-01-01'),
};

// ---------------------------------------------------------------------------
// Property 10: Dynamic Field Availability After Addition
// Validates: Requirements 4.2
// ---------------------------------------------------------------------------
describe('Property 10: Dynamic Field Availability After Addition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('after addField succeeds, getSchema returns the new field', async () => {
    /**
     * **Validates: Requirements 4.2**
     * For any existing set of records, adding a new dynamic field makes it
     * accessible on all existing records with null/default value.
     * We verify: after addField, getSchema includes the new field.
     */
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          name: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
          field_type: fc.constantFrom<FieldType>('text', 'integer', 'float', 'date', 'status'),
          display_order: fc.integer({ min: 0, max: 100 }),
        }),
        fc.uuid(),
        async (input, tenantId) => {
          const { pool } = await import('../db/pool') as unknown as { pool: { query: ReturnType<typeof vi.fn> } };

          const newField: DynamicField = {
            ...mockField,
            id: 'new-field-id',
            tenant_id: tenantId,
            name: input.name,
            field_type: input.field_type,
            display_order: input.display_order,
          };

          // addField: count check returns 0, then INSERT returns new field
          pool.query
            .mockResolvedValueOnce({ rows: [{ cnt: '0' }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [newField], rowCount: 1 });

          const added = await addField(tenantId, input);
          expect(added.name).toBe(input.name);
          expect(added.field_type).toBe(input.field_type);

          // getSchema returns the new field
          pool.query.mockResolvedValueOnce({ rows: [newField], rowCount: 1 });

          const schema = await getSchema(tenantId);
          const found = schema.find((f) => f.id === newField.id);
          expect(found).toBeDefined();
          expect(found!.name).toBe(input.name);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 11: Field Rename Consistency
// Validates: Requirements 4.3
// ---------------------------------------------------------------------------
describe('Property 11: Field Rename Consistency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renameField returns updated field with new name and calls UPDATE', async () => {
    /**
     * **Validates: Requirements 4.3**
     * For any field referenced in formulas and alert_rules, renameField should
     * update the field name so no formula retains the old name.
     */
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
        async (tenantId, fieldId, oldName, newName) => {
          fc.pre(oldName !== newName);

          const { pool } = await import('../db/pool') as unknown as { pool: { query: ReturnType<typeof vi.fn> } };

          // Clear mock state between iterations
          vi.clearAllMocks();

          const updatedField: DynamicField = {
            ...mockField,
            id: fieldId,
            tenant_id: tenantId,
            name: newName,
          };

          // conflict check returns no conflict, UPDATE returns updated field, formula cascade
          pool.query
            .mockResolvedValueOnce({ rows: [], rowCount: 0 })   // conflict check
            .mockResolvedValueOnce({ rows: [updatedField], rowCount: 1 }) // UPDATE dynamic_fields
            .mockResolvedValueOnce({ rows: [], rowCount: 0 });  // UPDATE formulas cascade

          const result = await renameField(tenantId, fieldId, newName);

          // Returned field has the new name
          expect(result.name).toBe(newName);
          expect(result.id).toBe(fieldId);

          // Verify UPDATE was called with the new name as a parameter
          const calls = (pool.query as ReturnType<typeof vi.fn>).mock.calls;
          const updateCall = calls.find(
            (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('UPDATE dynamic_fields'),
          );
          expect(updateCall).toBeDefined();
          // params[0] is newName ($1 in the UPDATE SET name = $1 query)
          expect(updateCall![1][0]).toBe(newName);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 12: Field Deletion Invalidates Dependents
// Validates: Requirements 4.4
// ---------------------------------------------------------------------------
describe('Property 12: Field Deletion Invalidates Dependents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deleteField marks dependent formulas and alert_rules as invalid', async () => {
    /**
     * **Validates: Requirements 4.4**
     * For any field with dependent formulas/alert_rules, deleteField should
     * mark them as has_error=true / is_active=false.
     */
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        fc.array(fc.uuid(), { minLength: 1, maxLength: 5 }),
        fc.array(fc.uuid(), { minLength: 1, maxLength: 3 }),
        async (tenantId, fieldId, formulaIds, alertRuleIds) => {
          const { pool } = await import('../db/pool') as unknown as { pool: { query: ReturnType<typeof vi.fn> } };

          const fieldRow: DynamicField = {
            ...mockField,
            id: fieldId,
            tenant_id: tenantId,
          };

          // Mock sequence: find field → soft delete → update formulas → update alert_rules → audit log
          pool.query
            .mockResolvedValueOnce({ rows: [fieldRow], rowCount: 1 })  // SELECT field
            .mockResolvedValueOnce({ rows: [], rowCount: 1 })           // soft delete
            .mockResolvedValueOnce({                                     // UPDATE formulas
              rows: formulaIds.map((id) => ({ id })),
              rowCount: formulaIds.length,
            })
            .mockResolvedValueOnce({                                     // UPDATE alert_rules
              rows: alertRuleIds.map((id) => ({ id })),
              rowCount: alertRuleIds.length,
            })
            .mockResolvedValueOnce({ rows: [], rowCount: 1 });           // audit log INSERT

          const result = await deleteField(tenantId, fieldId);

          // Affected lists are returned
          expect(result.affectedFormulas).toHaveLength(formulaIds.length);
          expect(result.affectedAlertRules).toHaveLength(alertRuleIds.length);
          expect(result.affectedFormulas).toEqual(formulaIds);
          expect(result.affectedAlertRules).toEqual(alertRuleIds);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 13: Dynamic Field Name Uniqueness
// Validates: Requirements 4.5
// ---------------------------------------------------------------------------
describe('Property 13: Dynamic Field Name Uniqueness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adding a duplicate name for same tenant throws ConflictError; different tenant succeeds', async () => {
    /**
     * **Validates: Requirements 4.5**
     * For any tenant, adding a field with a name that already exists should
     * throw ConflictError. For a different tenant, the same name should succeed.
     */
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
        async (tenantAId, tenantBId, fieldName) => {
          fc.pre(tenantAId !== tenantBId);

          const { pool } = await import('../db/pool') as unknown as { pool: { query: ReturnType<typeof vi.fn> } };

          const pgConflictError = Object.assign(new Error('duplicate key'), { code: '23505' });

          // Tenant A: count check ok, then INSERT throws 23505
          pool.query
            .mockResolvedValueOnce({ rows: [{ cnt: '1' }], rowCount: 1 }) // count check
            .mockRejectedValueOnce(pgConflictError);                        // INSERT conflict

          await expect(
            addField(tenantAId, { name: fieldName, field_type: 'text' }),
          ).rejects.toBeInstanceOf(ConflictError);

          // Tenant B: count check ok, INSERT succeeds
          const newField: DynamicField = {
            ...mockField,
            tenant_id: tenantBId,
            name: fieldName,
          };
          pool.query
            .mockResolvedValueOnce({ rows: [{ cnt: '0' }], rowCount: 1 }) // count check
            .mockResolvedValueOnce({ rows: [newField], rowCount: 1 });     // INSERT success

          const result = await addField(tenantBId, { name: fieldName, field_type: 'text' });
          expect(result.name).toBe(fieldName);
          expect(result.tenant_id).toBe(tenantBId);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 16: Validation Constraint Enforcement
// Validates: Requirements 4.11
// ---------------------------------------------------------------------------
describe('Property 16: Validation Constraint Enforcement', () => {
  it('integer values outside [min, max] are rejected with an error', () => {
    /**
     * **Validates: Requirements 4.11**
     * For any field with constraints and any value that violates them,
     * validateFieldValue should return { valid: false, error: ... }.
     */
    fc.assert(
      fc.property(
        fc.record({
          field_type: fc.constant('integer' as FieldType),
          constraints: fc.record({ min: fc.constant(0), max: fc.constant(100) }),
        }),
        fc.oneof(fc.integer({ min: -1000, max: -1 }), fc.integer({ min: 101, max: 1000 })),
        (fieldPartial, value) => {
          const field = { ...mockField, ...fieldPartial } as DynamicField;
          const result = validateFieldValue(field, value);
          expect(result.valid).toBe(false);
          expect(result.error).toBeDefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('integer values within [min, max] are accepted', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        (value) => {
          const field = {
            ...mockField,
            field_type: 'integer' as FieldType,
            constraints: { min: 0, max: 100 },
          } as DynamicField;
          const result = validateFieldValue(field, value);
          expect(result.valid).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('text values exceeding maxLength are rejected', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 1, max: 30 }),
        (maxLength, extra) => {
          const value = 'x'.repeat(maxLength + extra);
          const field = {
            ...mockField,
            field_type: 'text' as FieldType,
            constraints: { maxLength },
          } as DynamicField;
          const result = validateFieldValue(field, value);
          expect(result.valid).toBe(false);
          expect(result.error).toBeDefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('text values within maxLength are accepted', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 5, max: 50 }),
        fc.integer({ min: 0, max: 4 }),
        (maxLength, shorter) => {
          const value = 'x'.repeat(maxLength - shorter);
          const field = {
            ...mockField,
            field_type: 'text' as FieldType,
            constraints: { maxLength },
          } as DynamicField;
          const result = validateFieldValue(field, value);
          expect(result.valid).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('validateRecordData runs validation for each field present in data', () => {
    const schema: DynamicField[] = [
      { ...mockField, id: 'f1', field_type: 'integer', constraints: { min: 0, max: 10 } },
      { ...mockField, id: 'f2', field_type: 'text', constraints: { maxLength: 5 } },
    ];

    // f1 violates min, f2 is fine
    const data = { f1: -1, f2: 'hi' };
    const results = validateRecordData(schema, data);

    expect(results).toHaveLength(2);
    const f1Result = results.find((r) => r.field_id === 'f1');
    const f2Result = results.find((r) => r.field_id === 'f2');
    expect(f1Result?.valid).toBe(false);
    expect(f2Result?.valid).toBe(true);
  });

  it('deleteField throws NotFoundError when field does not exist', async () => {
    const { pool } = await import('../db/pool') as unknown as { pool: { query: ReturnType<typeof vi.fn> } };
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(deleteField('tenant-1', 'nonexistent-field')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('renameField throws NotFoundError when field does not exist', async () => {
    const { pool } = await import('../db/pool') as unknown as { pool: { query: ReturnType<typeof vi.fn> } };
    pool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })  // conflict check
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // UPDATE returns nothing

    await expect(renameField('tenant-1', 'nonexistent-field', 'new-name')).rejects.toBeInstanceOf(NotFoundError);
  });
});
