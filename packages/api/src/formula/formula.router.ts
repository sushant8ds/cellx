import { Router, Request, Response } from 'express';
import { AuthMiddleware, TenantIsolationMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import {
  createFormula, getFormulas, updateFormula, deleteFormula,
  FormulaError, NotFoundError,
} from './formula.service';

export const formulaRouter = Router();

formulaRouter.use(AuthMiddleware, TenantIsolationMiddleware);

// GET /tenants/:tenantId/formulas
formulaRouter.get('/:tenantId/formulas', requirePermission('schema:read'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await getFormulas(req.params['tenantId'] as string));
    } catch { res.status(500).json({ error: 'Internal server error' }); }
  });

// POST /tenants/:tenantId/formulas
formulaRouter.post('/:tenantId/formulas', requirePermission('formulas:write'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const formula = await createFormula(req.params['tenantId'] as string, req.body);
      res.status(201).json(formula);
    } catch (err) {
      if (err instanceof FormulaError) { res.status(422).json({ error: err.message }); return; }
      res.status(500).json({ error: 'Internal server error' });
    }
  });

// PATCH /tenants/:tenantId/formulas/:formulaId
formulaRouter.patch('/:tenantId/formulas/:formulaId', requirePermission('formulas:write'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const formula = await updateFormula(req.params['tenantId'] as string, req.params['formulaId'] as string, req.body);
      res.json(formula);
    } catch (err) {
      if (err instanceof NotFoundError) { res.status(404).json({ error: err.message }); return; }
      if (err instanceof FormulaError) { res.status(422).json({ error: err.message }); return; }
      res.status(500).json({ error: 'Internal server error' });
    }
  });

// DELETE /tenants/:tenantId/formulas/:formulaId
formulaRouter.delete('/:tenantId/formulas/:formulaId', requirePermission('formulas:write'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      await deleteFormula(req.params['tenantId'] as string, req.params['formulaId'] as string);
      res.status(204).send();
    } catch (err) {
      if (err instanceof NotFoundError) { res.status(404).json({ error: err.message }); return; }
      res.status(500).json({ error: 'Internal server error' });
    }
  });
