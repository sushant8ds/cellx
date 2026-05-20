/**
 * SchemaService — CRUD for dynamic_fields
 * Feature: universal-data-calibration-platform
 */
import { pool } from '../db/pool';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FieldType = 'text' | 'integer' | 'float' | 'date' | 'status';

export interface FieldConstraints {
  min?: number;
  max?: number;
  maxLength?: number;
  dateDirection?: 'past' | 'future';
}

export interface DynamicField {
  id: string;
  tenant_id: string;
  name: string;
  field_type: FieldType;
  dropdown_values: string[] | null;
  constraints: FieldConstraints | null;
  display_order: number;
  is_deleted: boolean;
  deleted_at: Date | null;
  created_at: Date;
}

export interface ValidationResult {
  field_id: string;
  valid: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class SchemaError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'SchemaError';
  }
}

export class ConflictError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'ConflictError';
  }
}

export class NotFoundError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'NotFoundError';
  }
}

// ---------------------------------------------------------------------------
// addField
// ---------------------------------------------------------------------------

export async function addField(
  tenantId: string,
  input: {
    name: string;
    field_type: FieldType;
    dropdown_values?: string[] | null;
    constraints?: FieldConstraints | null;
    display_order?: number;
  },
): Promise<DynamicField> {
  // Enforce max 200 active fields per tenant
  const countResult = await pool.query(
    `SELECT COUNT(*) AS cnt FROM dynamic_fields WHERE tenant_id = $1 AND is_deleted = false`,
    [tenantId],
  );
  const count = parseInt(countResult.rows[0].cnt, 10);
  if (count >= 200) {
    throw new SchemaError('Tenant has reached the maximum of 200 active fields');
  }

  try {
    const result = await pool.query(
      `INSERT INTO dynamic_fields
         (tenant_id, name, field_type, dropdown_values, constraints, display_order)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        tenantId,
        input.name,
        input.field_type,
        input.dropdown_values ?? null,
        input.constraints ? JSON.stringify(input.constraints) : null,
        input.display_order ?? 0,
      ],
    );
    return result.rows[0] as DynamicField;
  } catch (err: unknown) {
    const pgErr = err as { code?: string };
    if (pgErr.code === '23505') {
      throw new ConflictError(`A field named "${input.name}" already exists for this tenant`);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// getSchema
// ---------------------------------------------------------------------------

export async function getSchema(tenantId: string): Promise<DynamicField[]> {
  const result = await pool.query(
    `SELECT * FROM dynamic_fields
     WHERE tenant_id = $1 AND is_deleted = false
     ORDER BY display_order ASC`,
    [tenantId],
  );
  return result.rows as DynamicField[];
}

// ---------------------------------------------------------------------------
// renameField
// ---------------------------------------------------------------------------

export async function renameField(
  tenantId: string,
  fieldId: string,
  newName: string,
): Promise<DynamicField> {
  // Check for name conflict first
  const conflictCheck = await pool.query(
    `SELECT id FROM dynamic_fields
     WHERE tenant_id = $1 AND name = $2 AND is_deleted = false AND id != $3`,
    [tenantId, newName, fieldId],
  );
  if (conflictCheck.rows.length > 0) {
    throw new ConflictError(`A field named "${newName}" already exists for this tenant`);
  }

  // Rename the field
  const result = await pool.query(
    `UPDATE dynamic_fields
     SET name = $1
     WHERE id = $2 AND tenant_id = $3 AND is_deleted = false
     RETURNING *`,
    [newName, fieldId, tenantId],
  );

  if (result.rows.length === 0) {
    throw new NotFoundError(`Field ${fieldId} not found`);
  }

  const field = result.rows[0] as DynamicField;

  // Cascade rename to formulas AST: replace field_name references in JSONB ast
  // The AST stores field references by fieldId, but we also update any name-based references
  await pool.query(
    `UPDATE formulas
     SET ast = replace(ast::text, $1, $2)::jsonb
     WHERE tenant_id = $3 AND $4 = ANY(referenced_field_ids)`,
    [JSON.stringify(field.name), JSON.stringify(newName), tenantId, fieldId],
  );

  // alert_rules use target_field_id (UUID), not name — no rename needed

  return field;
}

// ---------------------------------------------------------------------------
// deleteField
// ---------------------------------------------------------------------------

export async function deleteField(
  tenantId: string,
  fieldId: string,
): Promise<{ affectedFormulas: string[]; affectedAlertRules: string[] }> {
  // Find the field first
  const fieldResult = await pool.query(
    `SELECT * FROM dynamic_fields
     WHERE id = $1 AND tenant_id = $2 AND is_deleted = false`,
    [fieldId, tenantId],
  );

  if (fieldResult.rows.length === 0) {
    throw new NotFoundError(`Field ${fieldId} not found`);
  }

  const field = fieldResult.rows[0] as DynamicField;

  // Soft delete the field
  await pool.query(
    `UPDATE dynamic_fields
     SET is_deleted = true, deleted_at = now()
     WHERE id = $1 AND tenant_id = $2`,
    [fieldId, tenantId],
  );

  // Mark dependent formulas as has_error = true
  const formulaResult = await pool.query(
    `UPDATE formulas
     SET has_error = true
     WHERE tenant_id = $1 AND $2 = ANY(referenced_field_ids)
     RETURNING id`,
    [tenantId, fieldId],
  );
  const affectedFormulas = formulaResult.rows.map((r: { id: string }) => r.id);

  // Mark dependent alert_rules as is_active = false
  const alertResult = await pool.query(
    `UPDATE alert_rules
     SET is_active = false
     WHERE tenant_id = $1 AND target_field_id = $2
     RETURNING id`,
    [tenantId, fieldId],
  );
  const affectedAlertRules = alertResult.rows.map((r: { id: string }) => r.id);

  // Write audit log entry
  await pool.query(
    `INSERT INTO audit_log
       (tenant_id, actor_user_id, entity_type, action, field_name, metadata)
     VALUES ($1, $2, 'schema', 'delete', $3, $4)`,
    [
      tenantId,
      '00000000-0000-0000-0000-000000000000', // system actor; real actor injected by middleware
      field.name,
      JSON.stringify({ field_id: fieldId, affectedFormulas, affectedAlertRules }),
    ],
  );

  return { affectedFormulas, affectedAlertRules };
}

// ---------------------------------------------------------------------------
// validateFieldValue
// ---------------------------------------------------------------------------

export function validateFieldValue(
  field: DynamicField,
  value: unknown,
): { valid: boolean; error?: string } {
  if (value === null || value === undefined) {
    return { valid: true };
  }

  const c = field.constraints;

  if (field.field_type === 'integer' || field.field_type === 'float') {
    const num = Number(value);
    if (isNaN(num)) {
      return { valid: false, error: `Field "${field.name}" must be a number` };
    }
    if (field.field_type === 'integer' && !Number.isInteger(num)) {
      return { valid: false, error: `Field "${field.name}" must be an integer` };
    }
    if (c) {
      if (c.min !== undefined && num < c.min) {
        return { valid: false, error: `Field "${field.name}" must be >= ${c.min} (got ${num})` };
      }
      if (c.max !== undefined && num > c.max) {
        return { valid: false, error: `Field "${field.name}" must be <= ${c.max} (got ${num})` };
      }
    }
    return { valid: true };
  }

  if (field.field_type === 'text') {
    const str = String(value);
    if (c?.maxLength !== undefined && str.length > c.maxLength) {
      return {
        valid: false,
        error: `Field "${field.name}" exceeds max length of ${c.maxLength} (got ${str.length})`,
      };
    }
    return { valid: true };
  }

  if (field.field_type === 'date') {
    const d = value instanceof Date ? value : new Date(String(value));
    if (isNaN(d.getTime())) {
      return { valid: false, error: `Field "${field.name}" must be a valid date` };
    }
    if (c?.dateDirection === 'past' && d > new Date()) {
      return { valid: false, error: `Field "${field.name}" must be a past date` };
    }
    if (c?.dateDirection === 'future' && d < new Date()) {
      return { valid: false, error: `Field "${field.name}" must be a future date` };
    }
    return { valid: true };
  }

  if (field.field_type === 'status') {
    if (field.dropdown_values && !field.dropdown_values.includes(String(value))) {
      return {
        valid: false,
        error: `Field "${field.name}" must be one of: ${field.dropdown_values.join(', ')}`,
      };
    }
    return { valid: true };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// validateRecordData
// ---------------------------------------------------------------------------

export function validateRecordData(
  schema: DynamicField[],
  data: Record<string, unknown>,
): ValidationResult[] {
  const results: ValidationResult[] = [];
  for (const field of schema) {
    if (Object.prototype.hasOwnProperty.call(data, field.id)) {
      const result = validateFieldValue(field, data[field.id]);
      results.push({ field_id: field.id, ...result });
    }
  }
  return results;
}
