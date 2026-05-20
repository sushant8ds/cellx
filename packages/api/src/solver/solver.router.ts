import { Router, Request, Response } from 'express';
import { AuthMiddleware, TenantIsolationMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import {
  buildProblem, solve, validateAssignments,
  createConstraintRule, getConstraintRules, updateConstraintRule, deleteConstraintRule,
  type ConstraintType,
} from './solver.service';
import { pool } from '../db/pool';

export const solverRouter = Router();

solverRouter.use(AuthMiddleware, TenantIsolationMiddleware);

// ---------------------------------------------------------------------------
// Constraint Rules CRUD
// ---------------------------------------------------------------------------

solverRouter.get('/:tenantId/constraint-rules', requirePermission('schema:write'),
  async (req: Request, res: Response): Promise<void> => {
    try { res.json(await getConstraintRules(req.params['tenantId'] as string)); }
    catch { res.status(500).json({ error: 'Internal server error' }); }
  });

solverRouter.post('/:tenantId/constraint-rules', requirePermission('schema:write'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const rule = await createConstraintRule(req.params['tenantId'] as string, req.body as { name: string; type: ConstraintType; config: Record<string, unknown> });
      res.status(201).json(rule);
    } catch { res.status(500).json({ error: 'Internal server error' }); }
  });

solverRouter.patch('/:tenantId/constraint-rules/:ruleId', requirePermission('schema:write'),
  async (req: Request, res: Response): Promise<void> => {
    try { res.json(await updateConstraintRule(req.params['tenantId'] as string, req.params['ruleId'] as string, req.body)); }
    catch { res.status(500).json({ error: 'Internal server error' }); }
  });

solverRouter.delete('/:tenantId/constraint-rules/:ruleId', requirePermission('schema:write'),
  async (req: Request, res: Response): Promise<void> => {
    try { await deleteConstraintRule(req.params['tenantId'] as string, req.params['ruleId'] as string); res.status(204).send(); }
    catch { res.status(500).json({ error: 'Internal server error' }); }
  });

// ---------------------------------------------------------------------------
// Solver Run (async job)
// ---------------------------------------------------------------------------

solverRouter.post('/:tenantId/solver/run', requirePermission('schema:write'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const tenantId = req.params['tenantId'] as string;
      const {
        resourceFieldId, slotFieldId, itemFieldId,
        capacityFieldId, priorityFieldId = '',
        constraintRuleIds = [],
      } = req.body as {
        resourceFieldId: string; slotFieldId: string; itemFieldId: string;
        capacityFieldId: string; priorityFieldId?: string; constraintRuleIds?: string[];
      };

      // Create job record
      const jobResult = await pool.query(
        `INSERT INTO background_jobs (tenant_id, type, status, progress_percent, created_by)
         VALUES ($1, 'export', 'processing', 10, $2) RETURNING id`,
        [tenantId, req.user?.userId ?? '00000000-0000-0000-0000-000000000000'],
      );
      const jobId = jobResult.rows[0].id as string;

      // Run solver synchronously (fast for typical sizes; move to BullMQ for 10k+ items)
      const problem = await buildProblem(
        tenantId, resourceFieldId, slotFieldId, itemFieldId,
        capacityFieldId, priorityFieldId, constraintRuleIds,
      );
      const result = solve(problem);

      // Store assignments as records in the DB
      for (const assignment of result.assignments) {
        await pool.query(
          `INSERT INTO records (tenant_id, data) VALUES ($1, $2)`,
          [tenantId, JSON.stringify({
            _type: 'assignment',
            resource_id: assignment.resourceId,
            slot_id: assignment.slotId,
            item_ids: assignment.itemIds,
            is_override: assignment.isOverride,
          })],
        );
      }

      await pool.query(
        `UPDATE background_jobs SET status='completed', progress_percent=100, metadata=$1 WHERE id=$2`,
        [JSON.stringify({ result }), jobId],
      );

      res.json({ jobId, summary: result.summary, conflictCount: result.conflicts.length });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

// ---------------------------------------------------------------------------
// Get assignments
// ---------------------------------------------------------------------------

solverRouter.get('/:tenantId/solver/assignments', requirePermission('records:read'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await pool.query(
        `SELECT id, data FROM records WHERE tenant_id = $1 AND is_deleted = false AND data->>'_type' = 'assignment'`,
        [req.params['tenantId'] as string],
      );
      res.json(result.rows);
    } catch { res.status(500).json({ error: 'Internal server error' }); }
  });

// ---------------------------------------------------------------------------
// Manual override
// ---------------------------------------------------------------------------

solverRouter.post('/:tenantId/solver/assignments/:id/override', requirePermission('records:write'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const tenantId = req.params['tenantId'] as string;
      const id = req.params['id'] as string;
      const { resourceId, slotId } = req.body as { resourceId: string; slotId: string };

      const result = await pool.query(
        `UPDATE records SET data = jsonb_set(jsonb_set(data, '{resource_id}', $1::jsonb), '{is_override}', 'true')
         WHERE id = $2 AND tenant_id = $3 RETURNING *`,
        [JSON.stringify(resourceId), id, tenantId],
      );

      if (result.rowCount === 0) { res.status(404).json({ error: 'Assignment not found' }); return; }

      // Re-validate all assignments
      const allResult = await pool.query(
        `SELECT id, data FROM records WHERE tenant_id = $1 AND is_deleted = false AND data->>'_type' = 'assignment'`,
        [tenantId],
      );
      const assignments = allResult.rows.map((r: { id: string; data: Record<string, unknown> }) => ({
        resourceId: r.data['resource_id'] as string,
        slotId: r.data['slot_id'] as string,
        itemIds: r.data['item_ids'] as string[],
        isOverride: r.data['is_override'] as boolean,
      }));

      const rules = await getConstraintRules(tenantId);
      const violations = validateAssignments(assignments, rules, [], []);

      res.json({ updated: result.rows[0], violations });
    } catch { res.status(500).json({ error: 'Internal server error' }); }
  });

// ---------------------------------------------------------------------------
// Conflicts
// ---------------------------------------------------------------------------

solverRouter.get('/:tenantId/solver/conflicts', requirePermission('records:read'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await pool.query(
        `SELECT metadata FROM background_jobs WHERE tenant_id = $1 AND type = 'export' AND status = 'completed' ORDER BY created_at DESC LIMIT 1`,
        [req.params['tenantId'] as string],
      );
      if (result.rows.length === 0) { res.json([]); return; }
      const meta = result.rows[0].metadata as { result?: { conflicts?: unknown[] } };
      res.json(meta?.result?.conflicts ?? []);
    } catch { res.status(500).json({ error: 'Internal server error' }); }
  });
