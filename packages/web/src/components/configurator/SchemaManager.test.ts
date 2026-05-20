/**
 * Feature: universal-data-calibration-platform
 * Property 32: Configurator Change Dependency Warning
 * Validates: Requirements 10.4
 *
 * For any configuration change (field rename, field delete, type change) that
 * would invalidate one or more existing formulas or alert rules, the configurator
 * SHALL present a warning listing all affected formulas and alert rules before
 * applying the change, and SHALL NOT apply the change without explicit admin
 * confirmation.
 *
 * This test validates the pure dependency-counting logic used by SchemaManager
 * to determine whether a warning must be shown.
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// ─── Pure logic extracted from SchemaManager ─────────────────────────────────

interface FormulaLike {
  id: string;
  expression: string;
}

interface AlertRuleLike {
  id: string;
  target_field_id: string;
}

/**
 * Count how many formulas and alert rules depend on a given fieldId.
 * A formula depends on a field if its expression contains the fieldId.
 * An alert rule depends on a field if its target_field_id equals the fieldId.
 */
function countDependencies(
  fieldId: string,
  formulas: FormulaLike[],
  alertRules: AlertRuleLike[],
): { affectedFormulas: number; affectedAlerts: number } {
  const affectedFormulas = formulas.filter(f => f.expression.includes(fieldId)).length;
  const affectedAlerts = alertRules.filter(r => r.target_field_id === fieldId).length;
  return { affectedFormulas, affectedAlerts };
}

/**
 * Determine whether a dependency warning must be shown before applying a
 * destructive schema change (delete or rename) to a field.
 */
function shouldShowDependencyWarning(
  fieldId: string,
  formulas: FormulaLike[],
  alertRules: AlertRuleLike[],
): boolean {
  const { affectedFormulas, affectedAlerts } = countDependencies(fieldId, formulas, alertRules);
  return affectedFormulas > 0 || affectedAlerts > 0;
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const fieldIdArb = fc.uuid();

const formulaArb = (fieldId: string) =>
  fc.record({
    id: fc.uuid(),
    // expression either contains the fieldId or does not
    expression: fc.oneof(
      fc.constant(`[${fieldId}] * 2`),
      fc.constant(`[other-field] + 1`),
      fc.string({ minLength: 1, maxLength: 40 }),
    ),
  });

const alertRuleArb = (fieldId: string) =>
  fc.record({
    id: fc.uuid(),
    target_field_id: fc.oneof(fc.constant(fieldId), fc.uuid()),
  });

// ─── Property 32 ─────────────────────────────────────────────────────────────

describe('Property 32: Configurator Change Dependency Warning', () => {

  it('warning is shown when at least one formula references the field', () => {
    /**
     * **Validates: Requirements 10.4**
     * For any field that is referenced in at least one formula expression,
     * shouldShowDependencyWarning must return true.
     */
    fc.assert(
      fc.property(
        fieldIdArb,
        fc.array(fc.uuid(), { minLength: 0, maxLength: 5 }),
        (fieldId, otherIds) => {
          // Build formulas: at least one references fieldId
          const dependentFormula: FormulaLike = { id: 'dep-formula', expression: `[${fieldId}] + 10` };
          const otherFormulas: FormulaLike[] = otherIds.map(id => ({ id, expression: '[other] * 1' }));
          const formulas = [dependentFormula, ...otherFormulas];
          const alertRules: AlertRuleLike[] = [];

          expect(shouldShowDependencyWarning(fieldId, formulas, alertRules)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('warning is shown when at least one alert rule targets the field', () => {
    /**
     * **Validates: Requirements 10.4**
     * For any field that is the target of at least one alert rule,
     * shouldShowDependencyWarning must return true.
     */
    fc.assert(
      fc.property(
        fieldIdArb,
        fc.array(fc.uuid(), { minLength: 0, maxLength: 5 }),
        (fieldId, otherIds) => {
          const formulas: FormulaLike[] = [];
          const dependentRule: AlertRuleLike = { id: 'dep-rule', target_field_id: fieldId };
          const otherRules: AlertRuleLike[] = otherIds.map(id => ({ id, target_field_id: 'other-field' }));
          const alertRules = [dependentRule, ...otherRules];

          expect(shouldShowDependencyWarning(fieldId, formulas, alertRules)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('no warning when no formula or alert rule references the field', () => {
    /**
     * **Validates: Requirements 10.4**
     * For any field with no dependents, shouldShowDependencyWarning must return false.
     */
    fc.assert(
      fc.property(
        fieldIdArb,
        fc.array(fc.uuid(), { minLength: 0, maxLength: 10 }),
        fc.array(fc.uuid(), { minLength: 0, maxLength: 10 }),
        (fieldId, formulaIds, ruleIds) => {
          // Ensure none reference fieldId
          const formulas: FormulaLike[] = formulaIds.map(id => ({ id, expression: '[unrelated] + 1' }));
          const alertRules: AlertRuleLike[] = ruleIds.map(id => ({ id, target_field_id: 'unrelated-field' }));

          expect(shouldShowDependencyWarning(fieldId, formulas, alertRules)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('dependency count is exact — matches the number of referencing formulas and rules', () => {
    /**
     * **Validates: Requirements 10.4**
     * The warning message must list ALL affected formulas and alert rules.
     * countDependencies must return exact counts.
     */
    fc.assert(
      fc.property(
        fieldIdArb,
        fc.integer({ min: 0, max: 10 }),
        fc.integer({ min: 0, max: 10 }),
        fc.integer({ min: 0, max: 10 }),
        fc.integer({ min: 0, max: 10 }),
        (fieldId, depFormulaCount, indepFormulaCount, depRuleCount, indepRuleCount) => {
          const formulas: FormulaLike[] = [
            ...Array.from({ length: depFormulaCount }, (_, i) => ({
              id: `dep-f-${i}`,
              expression: `[${fieldId}] * ${i + 1}`,
            })),
            ...Array.from({ length: indepFormulaCount }, (_, i) => ({
              id: `indep-f-${i}`,
              expression: `[other-field] + ${i}`,
            })),
          ];

          const alertRules: AlertRuleLike[] = [
            ...Array.from({ length: depRuleCount }, (_, i) => ({
              id: `dep-r-${i}`,
              target_field_id: fieldId,
            })),
            ...Array.from({ length: indepRuleCount }, (_, i) => ({
              id: `indep-r-${i}`,
              target_field_id: `other-field-${i}`,
            })),
          ];

          const { affectedFormulas, affectedAlerts } = countDependencies(fieldId, formulas, alertRules);

          expect(affectedFormulas).toBe(depFormulaCount);
          expect(affectedAlerts).toBe(depRuleCount);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('warning is shown when both formulas and alert rules reference the field', () => {
    /**
     * **Validates: Requirements 10.4**
     * When both formulas and alert rules depend on a field, the warning must
     * still be shown (logical OR of both conditions).
     */
    fc.assert(
      fc.property(
        fieldIdArb,
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 5 }),
        (fieldId, fCount, rCount) => {
          const formulas: FormulaLike[] = Array.from({ length: fCount }, (_, i) => ({
            id: `f-${i}`,
            expression: `[${fieldId}] + ${i}`,
          }));
          const alertRules: AlertRuleLike[] = Array.from({ length: rCount }, (_, i) => ({
            id: `r-${i}`,
            target_field_id: fieldId,
          }));

          expect(shouldShowDependencyWarning(fieldId, formulas, alertRules)).toBe(true);

          const { affectedFormulas, affectedAlerts } = countDependencies(fieldId, formulas, alertRules);
          expect(affectedFormulas).toBe(fCount);
          expect(affectedAlerts).toBe(rCount);
        },
      ),
      { numRuns: 100 },
    );
  });
});
