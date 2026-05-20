import { Router, Request, Response } from 'express';
import { AuthMiddleware } from '../middleware/auth.middleware';
import { SuperadminMiddleware } from '../middleware/rbac.middleware';
import {
  listTenants,
  suspendTenant,
  activateTenant,
  getHealthStats,
  triggerBackup,
} from './platform.service';

export const platformRouter = Router();

// All routes gated by AuthMiddleware + SuperadminMiddleware
platformRouter.use(AuthMiddleware, SuperadminMiddleware);

// GET /system-admin/tenants
platformRouter.get('/system-admin/tenants', async (_req: Request, res: Response) => {
  const tenants = await listTenants();
  res.json(tenants);
});

// POST /system-admin/tenants/:tenantId/suspend
platformRouter.post(
  '/system-admin/tenants/:tenantId/suspend',
  async (req: Request, res: Response) => {
    await suspendTenant(req.params['tenantId'] as string);
    res.status(204).send();
  },
);

// POST /system-admin/tenants/:tenantId/activate
platformRouter.post(
  '/system-admin/tenants/:tenantId/activate',
  async (req: Request, res: Response) => {
    await activateTenant(req.params['tenantId'] as string);
    res.status(204).send();
  },
);

// GET /system-admin/health
platformRouter.get('/system-admin/health', (_req: Request, res: Response) => {
  res.json(getHealthStats());
});

// POST /system-admin/backups/trigger
platformRouter.post('/system-admin/backups/trigger', async (_req: Request, res: Response) => {
  const result = await triggerBackup();
  res.status(202).json(result);
});
