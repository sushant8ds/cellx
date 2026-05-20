/**
 * AlertService — CRUD for alert_rules
 * Feature: universal-data-calibration-platform
 */
import { pool } from '../db/pool';

export type AlertOperator = 'eq' | 'neq' | 'lt' | 'gt' | 'lte' | 'gte';

export interface AlertRule {
  id: string;
  tenant_id: string;
  name: string;
  target_field_id: string;
  operator: AlertOperator;
  threshold: string;
  recipients: string[];
  is_active: boolean;
  last_evaluated: Date | null;
  created_at: Date;
}

export class NotFoundError extends Error {
  constructor(msg: string) { super(msg); this.name = 'NotFoundError'; }
}

export async function createAlertRule(
  tenantId: string,
  input: {
    name: string;
    target_field_id: string;
    operator: AlertOperator;
    threshold: string;
    recipients: string[];
  },
): Promise<AlertRule> {
  const result = await pool.query(
    `INSERT INTO alert_rules (tenant_id, name, target_field_id, operator, threshold, recipients)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [tenantId, input.name, input.target_field_id, input.operator, input.threshold, input.recipients],
  );
  return result.rows[0] as AlertRule;
}

export async function getAlertRules(tenantId: string): Promise<AlertRule[]> {
  const result = await pool.query(
    `SELECT * FROM alert_rules WHERE tenant_id = $1 ORDER BY created_at ASC`,
    [tenantId],
  );
  return result.rows as AlertRule[];
}

export async function updateAlertRule(
  tenantId: string,
  ruleId: string,
  input: Partial<Pick<AlertRule, 'name' | 'operator' | 'threshold' | 'recipients' | 'is_active'>>,
): Promise<AlertRule> {
  const updates: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (input.name !== undefined) { updates.push(`name = $${idx++}`); params.push(input.name); }
  if (input.operator !== undefined) { updates.push(`operator = $${idx++}`); params.push(input.operator); }
  if (input.threshold !== undefined) { updates.push(`threshold = $${idx++}`); params.push(input.threshold); }
  if (input.recipients !== undefined) { updates.push(`recipients = $${idx++}`); params.push(input.recipients); }
  if (input.is_active !== undefined) { updates.push(`is_active = $${idx++}`); params.push(input.is_active); }

  if (updates.length === 0) throw new Error('No fields to update');

  params.push(ruleId, tenantId);
  const result = await pool.query(
    `UPDATE alert_rules SET ${updates.join(', ')}
     WHERE id = $${idx++} AND tenant_id = $${idx}
     RETURNING *`,
    params,
  );
  if (result.rowCount === 0) throw new NotFoundError(`Alert rule ${ruleId} not found`);
  return result.rows[0] as AlertRule;
}

export async function deleteAlertRule(tenantId: string, ruleId: string): Promise<void> {
  const result = await pool.query(
    `DELETE FROM alert_rules WHERE id = $1 AND tenant_id = $2`,
    [ruleId, tenantId],
  );
  if (result.rowCount === 0) throw new NotFoundError(`Alert rule ${ruleId} not found`);
}

// Evaluate a single alert rule against all active records for the tenant
// Returns array of record IDs that triggered the rule
export async function evaluateAlertRule(
  tenantId: string,
  ruleId: string,
): Promise<{ triggeredRecordIds: string[]; rule: AlertRule }> {
  const ruleResult = await pool.query(
    `SELECT * FROM alert_rules WHERE id = $1 AND tenant_id = $2 AND is_active = true`,
    [ruleId, tenantId],
  );
  if (ruleResult.rows.length === 0) throw new NotFoundError(`Alert rule ${ruleId} not found or inactive`);

  const rule = ruleResult.rows[0] as AlertRule;

  // Build comparison SQL based on operator
  const opMap: Record<AlertOperator, string> = {
    eq: '=', neq: '!=', lt: '<', gt: '>', lte: '<=', gte: '>=',
  };
  const sqlOp = opMap[rule.operator];

  // Validate target_field_id is a UUID (defense in depth against SQL injection)
  if (!/^[0-9a-f-]{36}$/.test(rule.target_field_id)) {
    throw new Error('Invalid target_field_id format');
  }

  const recordsResult = await pool.query(
    `SELECT id FROM records
     WHERE tenant_id = $1 AND is_deleted = false
       AND (data->>'${rule.target_field_id}')::text ${sqlOp} $2`,
    [tenantId, rule.threshold],
  );

  const triggeredRecordIds = recordsResult.rows.map((r: { id: string }) => r.id);

  // Update last_evaluated timestamp
  await pool.query(
    `UPDATE alert_rules SET last_evaluated = now() WHERE id = $1`,
    [ruleId],
  );

  return { triggeredRecordIds, rule };
}

// Check if a value satisfies an alert rule condition (pure function for testing)
export function checkCondition(
  value: unknown,
  operator: AlertOperator,
  threshold: string,
): boolean {
  const numVal = Number(value);
  const numThreshold = Number(threshold);
  const strVal = String(value);

  // Try numeric comparison first
  if (!isNaN(numVal) && !isNaN(numThreshold)) {
    switch (operator) {
      case 'eq': return numVal === numThreshold;
      case 'neq': return numVal !== numThreshold;
      case 'lt': return numVal < numThreshold;
      case 'gt': return numVal > numThreshold;
      case 'lte': return numVal <= numThreshold;
      case 'gte': return numVal >= numThreshold;
    }
  }

  // Fall back to string comparison
  switch (operator) {
    case 'eq': return strVal === threshold;
    case 'neq': return strVal !== threshold;
    default: return false;
  }
}
