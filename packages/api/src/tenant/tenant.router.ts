import { Router, Request, Response } from 'express';
import { AuthMiddleware, TenantIsolationMiddleware } from '../middleware/auth.middleware';
import { SuperadminMiddleware } from '../middleware/rbac.middleware';
import { createTenant, getTenantById, ConflictError } from './tenant.service';

export const tenantRouter = Router();

// POST /tenants — create tenant (superadmin only)
tenantRouter.post('/', AuthMiddleware, SuperadminMiddleware, async (req: Request, res: Response) => {
  const { name, slug } = req.body as { name?: string; slug?: string };
  if (!name || !slug) {
    res.status(400).json({ error: 'name and slug are required' });
    return;
  }
  try {
    const tenant = await createTenant(name, slug);
    res.status(201).json(tenant);
  } catch (err) {
    if (err instanceof ConflictError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
});

// GET /tenants/:tenantId — get tenant info
tenantRouter.get(
  '/:tenantId',
  AuthMiddleware,
  TenantIsolationMiddleware,
  async (req: Request, res: Response) => {
    const tenant = await getTenantById(req.params['tenantId'] as string);
    if (!tenant) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }
    res.json(tenant);
  },
);
