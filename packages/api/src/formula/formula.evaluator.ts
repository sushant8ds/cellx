/**
 * Formula evaluator — walks AST against record data
 * Feature: universal-data-calibration-platform
 */
import { ASTNode } from './formula.parser';

export type ErrorResult = { error: 'division_by_zero' | 'type_mismatch' };
export type EvalResult = unknown | ErrorResult;

export function isErrorResult(value: unknown): value is ErrorResult {
  return typeof value === 'object' && value !== null && 'error' in value;
}

export function evaluateFormula(ast: ASTNode, data: Record<string, unknown>): EvalResult {
  switch (ast.type) {
    case 'number': return ast.value;
    case 'string': return ast.value;

    case 'field_ref': return data[ast.fieldId] ?? null;

    case 'binary_op': {
      const left = evaluateFormula(ast.left, data);
      const right = evaluateFormula(ast.right, data);
      if (isErrorResult(left)) return left;
      if (isErrorResult(right)) return right;
      const l = Number(left);
      const r = Number(right);
      if (isNaN(l) || isNaN(r)) return { error: 'type_mismatch' };
      if (ast.op === '/') {
        if (r === 0) return { error: 'division_by_zero' };
        return l / r;
      }
      if (ast.op === '+') return l + r;
      if (ast.op === '-') return l - r;
      if (ast.op === '*') return l * r;
      return { error: 'type_mismatch' };
    }

    case 'date_add': {
      const dateVal = evaluateFormula(ast.date, data);
      const daysVal = evaluateFormula(ast.days, data);
      if (isErrorResult(dateVal) || isErrorResult(daysVal)) return { error: 'type_mismatch' };
      const d = dateVal instanceof Date ? dateVal : new Date(String(dateVal));
      const days = Number(daysVal);
      if (isNaN(d.getTime()) || isNaN(days)) return { error: 'type_mismatch' };
      const result = new Date(d);
      result.setDate(result.getDate() + Math.round(days));
      return result.toISOString().split('T')[0]; // ISO date string
    }

    case 'if': {
      const cond = evaluateFormula(ast.condition, data);
      if (isErrorResult(cond)) return cond;
      return cond ? evaluateFormula(ast.then, data) : evaluateFormula(ast.else, data);
    }

    case 'compare': {
      const left = evaluateFormula(ast.left, data);
      const right = evaluateFormula(ast.right, data);
      if (isErrorResult(left) || isErrorResult(right)) return { error: 'type_mismatch' };
      switch (ast.op) {
        case '==': return left === right;
        case '!=': return left !== right;
        case '<':  return (left as number) < (right as number);
        case '>':  return (left as number) > (right as number);
        case '<=': return (left as number) <= (right as number);
        case '>=': return (left as number) >= (right as number);
      }
    }
  }
}

// Chunk-based evaluation for bulk updates — avoids blocking the event loop
export async function chunkEvaluate(
  records: Array<{ id: string; data: Record<string, unknown> }>,
  formulas: Array<{ id: string; target_field_id: string; ast: ASTNode }>,
  chunkSize = 500,
): Promise<Map<string, Record<string, unknown>>> {
  const results = new Map<string, Record<string, unknown>>();

  for (let i = 0; i < records.length; i += chunkSize) {
    const chunk = records.slice(i, i + chunkSize);
    for (const record of chunk) {
      const computed: Record<string, unknown> = {};
      for (const formula of formulas) {
        computed[formula.target_field_id] = evaluateFormula(formula.ast, record.data);
      }
      results.set(record.id, computed);
    }
    // Yield event loop between chunks
    if (i + chunkSize < records.length) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  return results;
}
