/**
 * Universal Constraint-Based Assignment Engine
 * Feature: universal-data-calibration-platform, Requirement 17
 *
 * Domain-agnostic solver. Works for any assignment problem:
 * exam invigilation, shift planning, room booking, delivery routing, etc.
 */
import { pool } from '../db/pool';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConstraintType =
  | 'min_assignments'
  | 'max_assignments'
  | 'no_simultaneous'
  | 'group_together'
  | 'capacity_limit'
  | 'priority_order'
  | 'exclusion'
  | 'formula';

export interface ConstraintRule {
  id: string;
  tenant_id: string;
  name: string;
  type: ConstraintType;
  config: Record<string, unknown>;
  is_active: boolean;
}

export interface Resource { id: string; data: Record<string, unknown> }
export interface Slot { id: string; data: Record<string, unknown>; capacity: number; priority: number }
export interface Item { id: string; data: Record<string, unknown>; groupKey?: string }

export interface Assignment {
  resourceId: string;
  slotId: string;
  itemIds: string[];
  isOverride: boolean;
}

export interface ConflictReport {
  slotId: string;
  reason: string;
  required: number;
  available: number;
}

export interface SolverResult {
  assignments: Assignment[];
  conflicts: ConflictReport[];
  summary: {
    totalSlots: number;
    assignedSlots: number;
    conflictSlots: number;
    resourceUtilization: Record<string, { assigned: number; min: number; max: number }>;
  };
}

export interface SolverProblem {
  tenantId: string;
  resources: Resource[];
  slots: Slot[];
  items: Item[];
  rules: ConstraintRule[];
}

// ---------------------------------------------------------------------------
// CRUD for constraint_rules
// ---------------------------------------------------------------------------

export async function createConstraintRule(
  tenantId: string,
  input: { name: string; type: ConstraintType; config: Record<string, unknown> },
): Promise<ConstraintRule> {
  const result = await pool.query(
    `INSERT INTO constraint_rules (tenant_id, name, type, config)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [tenantId, input.name, input.type, JSON.stringify(input.config)],
  );
  return result.rows[0] as ConstraintRule;
}

export async function getConstraintRules(tenantId: string): Promise<ConstraintRule[]> {
  const result = await pool.query(
    `SELECT * FROM constraint_rules WHERE tenant_id = $1 AND is_active = true ORDER BY created_at`,
    [tenantId],
  );
  return result.rows as ConstraintRule[];
}

// FIX: was using template literals that evaluated JS expressions instead of producing $N placeholders
export async function updateConstraintRule(
  tenantId: string,
  ruleId: string,
  input: Partial<Pick<ConstraintRule, 'name' | 'config' | 'is_active'>>,
): Promise<ConstraintRule> {
  const setClauses: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (input.name !== undefined) {
    setClauses.push('name = $' + idx);
    params.push(input.name);
    idx++;
  }
  if (input.config !== undefined) {
    setClauses.push('config = $' + idx);
    params.push(JSON.stringify(input.config));
    idx++;
  }
  if (input.is_active !== undefined) {
    setClauses.push('is_active = $' + idx);
    params.push(input.is_active);
    idx++;
  }

  if (setClauses.length === 0) throw new Error('No fields to update');

  params.push(ruleId, tenantId);
  const sql = `UPDATE constraint_rules SET ${setClauses.join(', ')} WHERE id = $${idx} AND tenant_id = $${idx + 1} RETURNING *`;

  const result = await pool.query(sql, params);
  if (result.rowCount === 0) throw new Error(`Constraint rule ${ruleId} not found`);
  return result.rows[0] as ConstraintRule;
}

export async function deleteConstraintRule(tenantId: string, ruleId: string): Promise<void> {
  await pool.query(`DELETE FROM constraint_rules WHERE id = $1 AND tenant_id = $2`, [ruleId, tenantId]);
}

// ---------------------------------------------------------------------------
// buildProblem — loads records from DB into solver-friendly structures
// ---------------------------------------------------------------------------

export async function buildProblem(
  tenantId: string,
  resourceFieldId: string,
  slotFieldId: string,
  itemFieldId: string,
  capacityFieldId: string,
  priorityFieldId: string,
  constraintRuleIds: string[],
): Promise<SolverProblem> {
  const recordsResult = await pool.query(
    `SELECT id, data FROM records WHERE tenant_id = $1 AND is_deleted = false`,
    [tenantId],
  );
  const allRecords = recordsResult.rows as { id: string; data: Record<string, unknown> }[];

  const resources: Resource[] = allRecords
    .filter(r => r.data[resourceFieldId] !== undefined && r.data[resourceFieldId] !== null)
    .map(r => ({ id: r.id, data: r.data }));

  const slots: Slot[] = allRecords
    .filter(r => r.data[slotFieldId] !== undefined && r.data[slotFieldId] !== null)
    .map(r => ({
      id: r.id,
      data: r.data,
      capacity: Number(r.data[capacityFieldId] ?? 1),
      priority: Number(r.data[priorityFieldId] ?? 0),
    }));

  const items: Item[] = allRecords
    .filter(r => r.data[itemFieldId] !== undefined && r.data[itemFieldId] !== null)
    .map(r => ({
      id: r.id,
      data: r.data,
      groupKey: r.data[itemFieldId] as string | undefined,
    }));

  let rules: ConstraintRule[];
  if (constraintRuleIds.length > 0) {
    const rulesResult = await pool.query(
      `SELECT * FROM constraint_rules WHERE id = ANY($1) AND tenant_id = $2 AND is_active = true`,
      [constraintRuleIds, tenantId],
    );
    rules = rulesResult.rows as ConstraintRule[];
  } else {
    rules = await getConstraintRules(tenantId);
  }

  return { tenantId, resources, slots, items, rules };
}

// ---------------------------------------------------------------------------
// solve — greedy first-fit with constraint validation (deterministic)
// ---------------------------------------------------------------------------

export function solve(problem: SolverProblem): SolverResult {
  const { resources, slots, items, rules } = problem;

  const minMap = new Map<string, number>();
  const maxMap = new Map<string, number>();
  const exclusions = new Map<string, Set<string>>();

  for (const rule of rules) {
    if (rule.type === 'min_assignments') {
      const { resourceField, value, fieldValue } = rule.config as {
        resourceField: string; value: number; fieldValue?: string;
      };
      for (const r of resources) {
        if (!fieldValue || String(r.data[resourceField]) === fieldValue) {
          // Take the minimum of multiple min rules (most restrictive)
          const existing = minMap.get(r.id) ?? 0;
          minMap.set(r.id, Math.max(existing, value));
        }
      }
    }
    if (rule.type === 'max_assignments') {
      const { resourceField, value, fieldValue } = rule.config as {
        resourceField: string; value: number; fieldValue?: string;
      };
      for (const r of resources) {
        if (!fieldValue || String(r.data[resourceField]) === fieldValue) {
          // Take the minimum of multiple max rules (most restrictive)
          const existing = maxMap.get(r.id) ?? Infinity;
          maxMap.set(r.id, Math.min(existing, value));
        }
      }
    }
    if (rule.type === 'exclusion') {
      const { resourceId, slotId } = rule.config as { resourceId: string; slotId: string };
      if (!exclusions.has(resourceId)) exclusions.set(resourceId, new Set());
      exclusions.get(resourceId)!.add(slotId);
    }
  }

  for (const r of resources) {
    if (!minMap.has(r.id)) minMap.set(r.id, 0);
    if (!maxMap.has(r.id)) maxMap.set(r.id, Infinity);
  }

  const assignmentCount = new Map<string, number>(resources.map(r => [r.id, 0]));
  const resourceSlotTimes = new Map<string, Set<string>>();
  const hasNoSimultaneous = rules.some(rule => rule.type === 'no_simultaneous');

  const assignments: Assignment[] = [];
  const conflicts: ConflictReport[] = [];

  // Deterministic sort: priority desc, capacity desc, id asc
  const sortedSlots = [...slots].sort((a, b) =>
    b.priority - a.priority || b.capacity - a.capacity || a.id.localeCompare(b.id),
  );

  const sortedItems = [...items].sort((a, b) =>
    (a.groupKey ?? '').localeCompare(b.groupKey ?? '') || a.id.localeCompare(b.id),
  );

  // Pre-compute group_together rule once (not inside the loop)
  const groupRule = rules.find(r => r.type === 'group_together');

  for (const slot of sortedSlots) {
    const slotTimeKey = String(slot.data['time_key'] ?? slot.id);
    const needed = slot.capacity;

    const eligible = resources.filter(r => {
      const count = assignmentCount.get(r.id) ?? 0;
      const max = maxMap.get(r.id) ?? Infinity;
      if (count >= max) return false;
      if (exclusions.get(r.id)?.has(slot.id)) return false;
      if (hasNoSimultaneous && resourceSlotTimes.get(r.id)?.has(slotTimeKey)) return false;
      return true;
    });

    // Deterministic sort: most available first, then by id
    eligible.sort((a, b) => {
      const aScore = (maxMap.get(a.id) ?? 10) - (assignmentCount.get(a.id) ?? 0);
      const bScore = (maxMap.get(b.id) ?? 10) - (assignmentCount.get(b.id) ?? 0);
      return bScore - aScore || a.id.localeCompare(b.id);
    });

    const selected = eligible.slice(0, needed);

    if (selected.length < needed) {
      conflicts.push({
        slotId: slot.id,
        reason: `Not enough eligible resources. Required: ${needed}, available: ${selected.length}`,
        required: needed,
        available: selected.length,
      });
    }

    // Items for this slot via group_together rule
    const slotItems = groupRule
      ? sortedItems.filter(item => {
          const { itemField, slotField } = groupRule.config as { itemField: string; slotField: string };
          return String(item.data[itemField]) === String(slot.data[slotField]);
        })
      : [];

    for (const resource of selected) {
      assignments.push({
        resourceId: resource.id,
        slotId: slot.id,
        itemIds: slotItems.map(i => i.id),
        isOverride: false,
      });
      assignmentCount.set(resource.id, (assignmentCount.get(resource.id) ?? 0) + 1);
      if (!resourceSlotTimes.has(resource.id)) resourceSlotTimes.set(resource.id, new Set());
      resourceSlotTimes.get(resource.id)!.add(slotTimeKey);
    }
  }

  const resourceUtilization: Record<string, { assigned: number; min: number; max: number }> = {};
  for (const r of resources) {
    resourceUtilization[r.id] = {
      assigned: assignmentCount.get(r.id) ?? 0,
      min: minMap.get(r.id) ?? 0,
      max: maxMap.get(r.id) === Infinity ? -1 : (maxMap.get(r.id) ?? 0),
    };
  }

  return {
    assignments,
    conflicts,
    summary: {
      totalSlots: slots.length,
      assignedSlots: slots.length - conflicts.length,
      conflictSlots: conflicts.length,
      resourceUtilization,
    },
  };
}

// ---------------------------------------------------------------------------
// validateAssignments — re-validate after manual overrides
// ---------------------------------------------------------------------------

export function validateAssignments(
  assignments: Assignment[],
  rules: ConstraintRule[],
  _resources: Resource[],
  slots: Slot[],
): Array<{ assignmentIdx: number; rule: string; reason: string }> {
  const violations: Array<{ assignmentIdx: number; rule: string; reason: string }> = [];

  const countMap = new Map<string, number>();
  for (const a of assignments) {
    countMap.set(a.resourceId, (countMap.get(a.resourceId) ?? 0) + 1);
  }

  for (const rule of rules) {
    if (rule.type === 'max_assignments') {
      const { value } = rule.config as { value: number };
      for (const [resourceId, count] of countMap.entries()) {
        if (count > value) {
          violations.push({
            assignmentIdx: -1,
            rule: rule.name,
            reason: `Resource ${resourceId} has ${count} assignments, max is ${value}`,
          });
        }
      }
    }
    if (rule.type === 'no_simultaneous') {
      const slotTimeMap = new Map<string, string>();
      for (const s of slots) slotTimeMap.set(s.id, String(s.data['time_key'] ?? s.id));
      const resourceTimeMap = new Map<string, Set<string>>();
      assignments.forEach((a, idx) => {
        const timeKey = slotTimeMap.get(a.slotId) ?? a.slotId;
        if (!resourceTimeMap.has(a.resourceId)) resourceTimeMap.set(a.resourceId, new Set());
        if (resourceTimeMap.get(a.resourceId)!.has(timeKey)) {
          violations.push({
            assignmentIdx: idx,
            rule: rule.name,
            reason: `Resource ${a.resourceId} assigned to two simultaneous slots`,
          });
        }
        resourceTimeMap.get(a.resourceId)!.add(timeKey);
      });
    }
  }

  return violations;
}
