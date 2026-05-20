import { Router, Request, Response } from 'express';
import { AuthMiddleware, TenantIsolationMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import {
  createAlertRule, getAlertRules, updateAlertRule, deleteAlertRule,
  evaluateAlertRule, NotFoundError,
} from './alert.service';

export const alertRouter = Router();

alertRouter.use(AuthMiddleware, TenantIsolationMiddleware);

// GET /tenants/:tenantId/alert-rules
alertRouter.get('/:tenantId/alert-rules', requirePermission('alerts:write'),
  async (req: Request, res: Response): Promise<void> => {
    try { res.json(await getAlertRules(req.params['tenantId'] as string)); }
    catch { res.status(500).json({ error: 'Internal server error' }); }
  });

// POST /tenants/:tenantId/alert-rules
alertRouter.post('/:tenantId/alert-rules', requirePermission('alerts:write'),
  async (req: Request, res: Response): Promise<void> => {
    try { res.status(201).json(await createAlertRule(req.params['tenantId'] as string, req.body)); }
    catch { res.status(500).json({ error: 'Internal server error' }); }
  });

// PATCH /tenants/:tenantId/alert-rules/:ruleId
alertRouter.patch('/:tenantId/alert-rules/:ruleId', requirePermission('alerts:write'),
  async (req: Request, res: Response): Promise<void> => {
    try { res.json(await updateAlertRule(req.params['tenantId'] as string, req.params['ruleId'] as string, req.body)); }
    catch (err) {
      if (err instanceof NotFoundError) { res.status(404).json({ error: err.message }); return; }
      res.status(500).json({ error: 'Internal server error' });
    }
  });

// DELETE /tenants/:tenantId/alert-rules/:ruleId
alertRouter.delete('/:tenantId/alert-rules/:ruleId', requirePermission('alerts:write'),
  async (req: Request, res: Response): Promise<void> => {
    try { await deleteAlertRule(req.params['tenantId'] as string, req.params['ruleId'] as string); res.status(204).send(); }
    catch (err) {
      if (err instanceof NotFoundError) { res.status(404).json({ error: err.message }); return; }
      res.status(500).json({ error: 'Internal server error' });
    }
  });

// POST /tenants/:tenantId/alert-rules/:ruleId/trigger — manual trigger
alertRouter.post('/:tenantId/alert-rules/:ruleId/trigger', requirePermission('alerts:trigger'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await evaluateAlertRule(req.params['tenantId'] as string, req.params['ruleId'] as string);
      res.json({ triggeredRecordIds: result.triggeredRecordIds, count: result.triggeredRecordIds.length });
    } catch (err) {
      if (err instanceof NotFoundError) { res.status(404).json({ error: err.message }); return; }
      res.status(500).json({ error: 'Internal server error' });
    }
  });
