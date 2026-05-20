import { Router, Request, Response } from 'express';
import { AuthMiddleware, TenantIsolationMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { queryAuditLog } from './audit.service';

export const auditRouter = Router();

auditRouter.use(AuthMiddleware, TenantIsolationMiddleware);

// GET /tenants/:tenantId/audit-log
auditRouter.get(
  '/:tenantId/audit-log',
  requirePermission('audit:read'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const tenantId = req.params['tenantId'] as string;
      const { dateFrom, dateTo, userId, recordId, entityType, limit, cursor } =
        req.query as Record<string, string>;

      const result = await queryAuditLog(tenantId, {
        dateFrom,
        dateTo,
        userId,
        recordId,
        entityType,
        limit: limit ? parseInt(limit, 10) : undefined,
        cursor,
      });

      res.json(result);
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);
