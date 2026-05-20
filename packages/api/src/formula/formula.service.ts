/**
 * FormulaService — CRUD for formulas + recalculation
 * Feature: universal-data-calibration-platform
 */
import { pool } from '../db/pool';
import { parseFormula, extractFieldRefs, ASTNode, ParseError } from './formula.parser';
import { evaluateFormula, isErrorResult } from './formula.evaluator';

export interface Formula {
  id: string;
  tenant_id: string;
  name: string;
  target_field_id: string;
  expression: string;
  ast: ASTNode;
  referenced_field_ids: string[];
  is_active: boolean;
  has_error: boolean;
  created_at: Date;
  updated_at: Date;
}

export class FormulaError extends Error {
  constructor(msg: string) { super(msg); this.name = 'FormulaError'; }
}

export class NotFoundError extends Error {
  constructor(msg: string) { super(msg); this.name = 'NotFoundError'; }
}

export async function createFormula(
  tenantId: string,
  input: { name: string; target_field_id: string; expression: string },
): Promise<Formula> {
  let ast: ASTNode;
  try {
    ast = parseFormula(input.expression);
  } catch (err) {
    if (err instanceof ParseError) throw new FormulaError(err.message);
    throw err;
  }

  const referencedFieldIds = [...new Set(extractFieldRefs(ast))];

  const result = await pool.query(
    `INSERT INTO formulas (tenant_id, name, target_field_id, expression, ast, referenced_field_ids)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [tenantId, input.name, input.target_field_id, input.expression, JSON.stringify(ast), referencedFieldIds],
  );
  return result.rows[0] as Formula;
}

export async function getFormulas(tenantId: string): Promise<Formula[]> {
  const result = await pool.query(
    `SELECT * FROM formulas WHERE tenant_id = $1 AND is_active = true ORDER BY created_at ASC`,
    [tenantId],
  );
  return result.rows as Formula[];
}

export async function updateFormula(
  tenantId: string,
  formulaId: string,
  input: { name?: string; expression?: string },
): Promise<Formula> {
  const updates: string[] = ['updated_at = now()', 'has_error = false'];
  const params: unknown[] = [];
  let idx = 1;

  if (input.name !== undefined) {
    updates.push(`name = $${idx++}`);
    params.push(input.name);
  }

  if (input.expression !== undefined) {
    let ast: ASTNode;
    try {
      ast = parseFormula(input.expression);
    } catch (err) {
      if (err instanceof ParseError) throw new FormulaError(err.message);
      throw err;
    }
    const referencedFieldIds = [...new Set(extractFieldRefs(ast))];
    updates.push(`expression = $${idx++}`, `ast = $${idx++}`, `referenced_field_ids = $${idx++}`);
    params.push(input.expression, JSON.stringify(ast), referencedFieldIds);
  }

  params.push(formulaId, tenantId);
  const result = await pool.query(
    `UPDATE formulas SET ${updates.join(', ')}
     WHERE id = $${idx++} AND tenant_id = $${idx}
     RETURNING *`,
    params,
  );

  if (result.rowCount === 0) throw new NotFoundError(`Formula ${formulaId} not found`);
  return result.rows[0] as Formula;
}

export async function deleteFormula(tenantId: string, formulaId: string): Promise<void> {
  const result = await pool.query(
    `DELETE FROM formulas WHERE id = $1 AND tenant_id = $2`,
    [formulaId, tenantId],
  );
  if (result.rowCount === 0) throw new NotFoundError(`Formula ${formulaId} not found`);
}

export async function recalculateForRecord(
  tenantId: string,
  _recordId: string,
  updatedFieldIds: string[],
  recordData: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await pool.query(
    `SELECT * FROM formulas
     WHERE tenant_id = $1 AND is_active = true
       AND referenced_field_ids && $2::uuid[]`,
    [tenantId, updatedFieldIds],
  );

  const computed: Record<string, unknown> = {};

  for (const row of result.rows as Formula[]) {
    const value = evaluateFormula(row.ast, recordData);
    if (isErrorResult(value)) {
      // Mark formula as errored
      await pool.query(
        `UPDATE formulas SET has_error = true WHERE id = $1`,
        [row.id],
      );
      computed[row.target_field_id] = null;
    } else {
      computed[row.target_field_id] = value;
    }
  }

  return computed;
}
