/**
 * Formula engine property tests
 * Feature: universal-data-calibration-platform
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { parseFormula, serializeAST, ParseError, MAX_AST_DEPTH } from './formula.parser';
import { evaluateFormula, isErrorResult } from './formula.evaluator';

vi.mock('../db/pool', () => ({ pool: { query: vi.fn() } }));
vi.mock('../schema/schema.service', () => ({ getSchema: vi.fn().mockResolvedValue([]) }));

// ---------------------------------------------------------------------------
// Property 17: Formula Syntax Round-Trip
// Validates: Requirements 5.2
// ---------------------------------------------------------------------------
describe('Property 17: Formula Syntax Round-Trip', () => {
  const validExpressions = [
    '1 + 2',
    '[field1] * [field2]',
    'IF([status] == "Safe", 1, 0)',
    'DATE_ADD([date_field], 30)',
    '[a] + [b] - [c]',
    '([x] + [y]) * 2',
    '[a] / [b]',
    'IF([x] > 10, [x], 0)',
  ];

  it('parseFormula(serializeAST(parseFormula(expr))) deep-equals parseFormula(expr)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...validExpressions),
        (expr) => {
          const ast1 = parseFormula(expr);
          const serialized = serializeAST(ast1);
          const ast2 = parseFormula(serialized);
          expect(ast2).toEqual(ast1);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 18: Formula Recalculation on Field Update
// Validates: Requirements 5.3
// ---------------------------------------------------------------------------
describe('Property 18: Formula Recalculation on Field Update', () => {
  beforeEach(() => vi.clearAllMocks());

  it('recalculateForRecord returns correct computed value for [a] + [b]', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: -1000, max: 1000 }),
        fc.integer({ min: -1000, max: 1000 }),
        fc.uuid(),
        async (a, b, targetFieldId) => {
          const { pool } = await import('../db/pool') as unknown as { pool: { query: ReturnType<typeof vi.fn> } };
          vi.clearAllMocks();

          const ast = parseFormula('[a] + [b]');
          pool.query.mockResolvedValueOnce({
            rows: [{
              id: 'formula-1',
              tenant_id: 'tenant-1',
              target_field_id: targetFieldId,
              ast,
              referenced_field_ids: ['a', 'b'],
              is_active: true,
              has_error: false,
            }],
            rowCount: 1,
          });

          const { recalculateForRecord } = await import('./formula.service');
          const result = await recalculateForRecord('tenant-1', 'record-1', ['a', 'b'], { a, b });

          expect(result[targetFieldId]).toBe(a + b);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 19: Formula Inverse Consistency
// Validates: Requirements 5.6
// ---------------------------------------------------------------------------
describe('Property 19: Formula Inverse Consistency', () => {
  it('applying [x] * 2 then reversing restores original value', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1000, max: 1000 }),
        (x) => {
          const ast = parseFormula('[x] * 2');
          const r1 = evaluateFormula(ast, { x }) as number;
          // Reverse: divide result by 2 to get back x
          const r2 = evaluateFormula(parseFormula('[x] / 2'), { x: r1 }) as number;
          expect(r2).toBe(x);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Additional correctness tests
// ---------------------------------------------------------------------------
describe('Formula Parser — edge cases', () => {
  it('throws ParseError for expression exceeding MAX_AST_DEPTH', () => {
    // Build deeply nested binary ops: 1+1+1+... nested 21 levels deep
    // Each binary_op adds 1 depth, so 21 nested additions exceed MAX_AST_DEPTH (20)
    // Structure: (1 + (1 + (1 + ... ))) — right-associative nesting via parens
    let deep = '1';
    for (let i = 0; i < 21; i++) {
      deep = `(${deep} + 1)`;
    }
    expect(() => parseFormula(deep)).toThrow(ParseError);
  });

  it(`accepts expression at exactly MAX_AST_DEPTH (${MAX_AST_DEPTH})`, () => {
    // Build exactly MAX_AST_DEPTH (20) levels of nesting using binary ops
    // Structure: (1 + (1 + (1 + ... ))) — 19 nested additions = depth 20
    let ok = '1';
    for (let i = 0; i < MAX_AST_DEPTH - 1; i++) {
      ok = `(${ok} + 1)`;
    }
    expect(() => parseFormula(ok)).not.toThrow();
  });

  it('parses IF expression correctly', () => {
    const ast = parseFormula('IF([status] == "Safe", 1, 0)');
    expect(ast.type).toBe('if');
  });

  it('parses DATE_ADD expression correctly', () => {
    const ast = parseFormula('DATE_ADD([calibration_date], 365)');
    expect(ast.type).toBe('date_add');
  });
});

describe('Formula Evaluator — error handling', () => {
  it('returns division_by_zero for [a] / [b] when b=0', () => {
    const ast = parseFormula('[a] / [b]');
    const result = evaluateFormula(ast, { a: 1, b: 0 });
    expect(isErrorResult(result)).toBe(true);
    expect((result as { error: string }).error).toBe('division_by_zero');
  });

  it('returns type_mismatch for [a] + [b] when a is text', () => {
    const ast = parseFormula('[a] + [b]');
    const result = evaluateFormula(ast, { a: 'text', b: 2 });
    expect(isErrorResult(result)).toBe(true);
    expect((result as { error: string }).error).toBe('type_mismatch');
  });

  it('evaluates arithmetic correctly', () => {
    expect(evaluateFormula(parseFormula('2 + 3'), {})).toBe(5);
    expect(evaluateFormula(parseFormula('10 - 4'), {})).toBe(6);
    expect(evaluateFormula(parseFormula('3 * 4'), {})).toBe(12);
    expect(evaluateFormula(parseFormula('10 / 2'), {})).toBe(5);
  });

  it('evaluates IF correctly', () => {
    const ast = parseFormula('IF([x] > 5, 1, 0)');
    expect(evaluateFormula(ast, { x: 10 })).toBe(1);
    expect(evaluateFormula(ast, { x: 3 })).toBe(0);
  });
});
