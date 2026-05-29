/**
 * SolverWizardService — translates plain-language wizard answers into
 * solver constraint rules + slot records, then runs the solver.
 *
 * Abstracts away "resources/slots/items" terminology entirely.
 * The wizard asks: "Who are you assigning?" / "Where?" / "How many duties?"
 */
import { pool } from '../db/pool';
import { createConstraintRule, solve, type SolverProblem, type SolverResult, type ConstraintRule } from './solver.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExamWizardAnswers {
  /** Column name that identifies faculty/people (e.g. "Name", "Faculty Name") */
  resourceNameField: string;
  /** Column name for experience/tier (e.g. "Experience", "Years", "Designation") */
  experienceField?: string;
  /** Number of exam rooms */
  classrooms: number;
  /** Time slots per day (1–4) */
  slotsPerDay: number;
  /** Number of exam days */
  examDays: number;
  /** Max duties for junior faculty */
  juniorMax: number;
  /** Max duties for mid-level faculty */
  midMax: number;
  /** Max duties for senior faculty */
  seniorMax: number;
  /** Prevent same person in two rooms at the same time */
  noSimultaneous: boolean;
  /** Optional: include supervisor role (1 per room, senior only) */
  includeSupervisor?: boolean;
  /** Optional: include relief duty (standby faculty) */
  reliefCount?: number;
}

export interface WizardRunResult {
  constraintRuleIds: string[];
  slotsCreated: number;
  solverResult: SolverResult;
  /** Human-readable summary for the UI */
  summary: {
    totalFaculty: number;
    totalSlots: number;
    assigned: number;
    conflicts: number;
    utilizationByTier: Record<string, { count: number; avgDuties: number }>;
  };
}

// ---------------------------------------------------------------------------
// Experience tier classifier
// Reads the experience field value and maps it to Junior/Mid/Senior
// ---------------------------------------------------------------------------

function classifyTier(value: string | undefined): 'Junior' | 'Mid' | 'Senior' {
  if (!value) return 'Mid';
  const v = value.toLowerCase().trim();

  // Explicit tier labels
  if (v.includes('junior') || v.includes('jr') || v === 'assistant professor') return 'Junior';
  if (v.includes('senior') || v.includes('sr') || v === 'professor') return 'Senior';
  if (v.includes('mid') || v.includes('associate')) return 'Mid';

  // Numeric years of experience
  const years = parseFloat(v);
  if (!isNaN(years)) {
    if (years <= 5) return 'Junior';
    if (years <= 15) return 'Mid';
    return 'Senior';
  }

  return 'Mid';
}

// ---------------------------------------------------------------------------
// buildProblemFromWizard
// ---------------------------------------------------------------------------

export async function buildProblemFromWizard(
  tenantId: string,
  answers: ExamWizardAnswers,
): Promise<WizardRunResult> {
  const slotNames = ['Morning', 'Afternoon', 'Evening', 'Night'];

  // ── 1. Load faculty records ──────────────────────────────────────────────
  const facultyResult = await pool.query<{ id: string; data: Record<string, unknown> }>(
    `SELECT id, data FROM records
     WHERE tenant_id = $1 AND is_deleted = false
       AND data->>'_type' IS DISTINCT FROM 'exam_slot'
       AND data->>'_type' IS DISTINCT FROM 'assignment'`,
    [tenantId],
  );
  const facultyRecords = facultyResult.rows;

  // ── 2. Create constraint rules ───────────────────────────────────────────
  const createdRules: ConstraintRule[] = [];

  // Delete any existing wizard-generated rules to avoid duplicates
  await pool.query(
    `DELETE FROM constraint_rules
     WHERE tenant_id = $1 AND name LIKE 'Wizard:%'`,
    [tenantId],
  );

  if (answers.experienceField) {
    createdRules.push(await createConstraintRule(tenantId, {
      name: 'Wizard: Junior faculty max duties',
      type: 'max_assignments',
      config: { resourceField: answers.experienceField, value: answers.juniorMax, fieldValue: 'Junior' },
    }));
    createdRules.push(await createConstraintRule(tenantId, {
      name: 'Wizard: Mid-level faculty max duties',
      type: 'max_assignments',
      config: { resourceField: answers.experienceField, value: answers.midMax, fieldValue: 'Mid' },
    }));
    createdRules.push(await createConstraintRule(tenantId, {
      name: 'Wizard: Senior faculty max duties',
      type: 'max_assignments',
      config: { resourceField: answers.experienceField, value: answers.seniorMax, fieldValue: 'Senior' },
    }));
  } else {
    // No experience field — apply a uniform max
    const uniformMax = Math.round((answers.juniorMax + answers.midMax + answers.seniorMax) / 3);
    createdRules.push(await createConstraintRule(tenantId, {
      name: 'Wizard: Max duties per faculty',
      type: 'max_assignments',
      config: { value: uniformMax },
    }));
  }

  if (answers.noSimultaneous) {
    createdRules.push(await createConstraintRule(tenantId, {
      name: 'Wizard: No simultaneous assignments',
      type: 'no_simultaneous',
      config: {},
    }));
  }

  // ── 3. Generate exam slot records ────────────────────────────────────────
  // Delete any previously wizard-generated slots
  await pool.query(
    `UPDATE records SET is_deleted = true, deleted_at = now()
     WHERE tenant_id = $1 AND data->>'_type' = 'exam_slot'`,
    [tenantId],
  );

  const slotIds: string[] = [];
  for (let day = 1; day <= answers.examDays; day++) {
    for (let slot = 0; slot < answers.slotsPerDay; slot++) {
      for (let room = 1; room <= answers.classrooms; room++) {
        const slotData = {
          _type: 'exam_slot',
          day: `Day ${day}`,
          time_slot: slotNames[slot] ?? `Slot ${slot + 1}`,
          room: `Room ${room}`,
          room_label: `Room ${room}`,
          time_key: `day${day}_slot${slot}`,
          capacity: 1,
          priority: answers.examDays - day,
        };
        const r = await pool.query<{ id: string }>(
          `INSERT INTO records (tenant_id, data) VALUES ($1, $2) RETURNING id`,
          [tenantId, JSON.stringify(slotData)],
        );
        slotIds.push(r.rows[0].id);
      }
    }
  }

  // ── 4. Classify faculty by tier (if experience field provided) ───────────
  if (answers.experienceField) {
    for (const faculty of facultyRecords) {
      const rawExp = String(faculty.data[answers.experienceField] ?? '');
      const tier = classifyTier(rawExp);
      if (faculty.data['_tier'] !== tier) {
        await pool.query(
          `UPDATE records SET data = jsonb_set(data, '{_tier}', $1::jsonb)
           WHERE id = $2 AND tenant_id = $3`,
          [JSON.stringify(tier), faculty.id, tenantId],
        );
        faculty.data['_tier'] = tier;
      }
    }
  }

  // ── 5. Build solver problem ──────────────────────────────────────────────
  const slotRecords = await pool.query<{ id: string; data: Record<string, unknown> }>(
    `SELECT id, data FROM records
     WHERE tenant_id = $1 AND is_deleted = false AND data->>'_type' = 'exam_slot'`,
    [tenantId],
  );

  const problem: SolverProblem = {
    tenantId,
    resources: facultyRecords.map(r => ({ id: r.id, data: r.data })),
    slots: slotRecords.rows.map(r => ({
      id: r.id,
      data: r.data,
      capacity: Number(r.data['capacity'] ?? 1),
      priority: Number(r.data['priority'] ?? 0),
    })),
    items: [],
    rules: createdRules,
  };

  // ── 6. Run solver ────────────────────────────────────────────────────────
  const solverResult = solve(problem);

  // ── 7. Persist assignments ───────────────────────────────────────────────
  // Clear previous assignments
  await pool.query(
    `UPDATE records SET is_deleted = true, deleted_at = now()
     WHERE tenant_id = $1 AND data->>'_type' = 'assignment'`,
    [tenantId],
  );

  if (solverResult.assignments.length > 0) {
    const tenantIds = solverResult.assignments.map(() => tenantId);
    const dataValues = solverResult.assignments.map(a => JSON.stringify({
      _type: 'assignment',
      resource_id: a.resourceId,
      slot_id: a.slotId,
      item_ids: a.itemIds,
      is_override: a.isOverride,
    }));
    await pool.query(
      `INSERT INTO records (tenant_id, data)
       SELECT * FROM unnest($1::uuid[], $2::jsonb[])`,
      [tenantIds, dataValues],
    );
  }

  // ── 8. Build utilization summary by tier ────────────────────────────────
  const tierCounts: Record<string, { total: number; duties: number }> = {
    Junior: { total: 0, duties: 0 },
    Mid: { total: 0, duties: 0 },
    Senior: { total: 0, duties: 0 },
    Unknown: { total: 0, duties: 0 },
  };

  for (const faculty of facultyRecords) {
    const tier = String(faculty.data['_tier'] ?? 'Unknown');
    const key = tier in tierCounts ? tier : 'Unknown';
    tierCounts[key].total++;
    const util = solverResult.summary.resourceUtilization[faculty.id];
    if (util) tierCounts[key].duties += util.assigned;
  }

  const utilizationByTier: Record<string, { count: number; avgDuties: number }> = {};
  for (const [tier, { total, duties }] of Object.entries(tierCounts)) {
    if (total > 0) {
      utilizationByTier[tier] = { count: total, avgDuties: Math.round((duties / total) * 10) / 10 };
    }
  }

  return {
    constraintRuleIds: createdRules.map(r => r.id),
    slotsCreated: slotIds.length,
    solverResult,
    summary: {
      totalFaculty: facultyRecords.length,
      totalSlots: slotIds.length,
      assigned: solverResult.summary.assignedSlots,
      conflicts: solverResult.summary.conflictSlots,
      utilizationByTier,
    },
  };
}
