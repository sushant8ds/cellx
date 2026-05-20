/**
 * RecordRouter — REST routes for records
 * Feature: universal-data-calibration-platform
 */
import { Router, Request, Response } from 'express';
import { AuthMiddleware, TenantIsolationMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import {
  listRecords,
  createRecord,
  updateRecord,
  deleteRecord,
  bulkUpdateRecords,
  bulkDeleteRecords,
  restoreRecord,
  ConcurrencyError,
  NotFoundError,
  ValidationError,
} from './record.service';

export const recordRouter = Router();

// All routes require auth + tenant isolation
recordRouter.use(AuthMiddleware, TenantIsolationMiddleware);

// GET /tenants/:tenantId/records
recordRouter.get(
  '/:tenantId/records',
  requirePermission('records:read'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const tenantId = req.params['tenantId'] as string;
      const { limit, cursor, sort_by, archived } = req.query as Record<string, string>;

      // Collect filter[fieldId]=value params
      const filters: Record<string, string> = {};
      for (const [key, val] of Object.entries(req.query)) {
        const match = key.match(/^filter\[(.+)\]$/);
        if (match && typeof val === 'string') {
          filters[match[1]] = val;
        }
      }

      const result = await listRecords(tenantId, {
        limit: limit ? parseInt(limit, 10) : undefined,
        cursor,
        sortBy: sort_by,
        filters: Object.keys(filters).length > 0 ? filters : undefined,
        archived: archived === 'true',
      });

      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// POST /tenants/:tenantId/records
recordRouter.post(
  '/:tenantId/records',
  requirePermission('records:write'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const tenantId = req.params['tenantId'] as string;
      const record = await createRecord(tenantId, req.body, req.user?.userId);
      res.status(201).json(record);
    } catch (err) {
      if (err instanceof ValidationError) {
        res.status(422).json({ error: err.message, field: err.field, constraint: err.constraint });
        return;
      }
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// POST /tenants/:tenantId/records/bulk-update
recordRouter.post(
  '/:tenantId/records/bulk-update',
  requirePermission('records:bulk'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const tenantId = req.params['tenantId'] as string;
      const { recordIds, fieldId, value } = req.body as {
        recordIds: string[];
        fieldId: string;
        value: unknown;
      };
      const result = await bulkUpdateRecords(tenantId, recordIds, fieldId, value, req.user?.userId);
      res.json(result);
    } catch (err) {
      if (err instanceof ValidationError) {
        res.status(422).json({ error: err.message, field: err.field, constraint: err.constraint });
        return;
      }
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// POST /tenants/:tenantId/records/bulk-delete
recordRouter.post(
  '/:tenantId/records/bulk-delete',
  requirePermission('records:bulk'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const tenantId = req.params['tenantId'] as string;
      const { recordIds } = req.body as { recordIds: string[] };
      const result = await bulkDeleteRecords(tenantId, recordIds, req.user?.userId);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// PATCH /tenants/:tenantId/records/:recordId
recordRouter.patch(
  '/:tenantId/records/:recordId',
  requirePermission('records:write'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const tenantId = req.params['tenantId'] as string;
      const recordId = req.params['recordId'] as string;
      const { data, version } = req.body as { data: Record<string, unknown>; version: number };
      const record = await updateRecord(tenantId, recordId, data, version, req.user?.userId);
      res.json(record);
    } catch (err) {
      if (err instanceof ConcurrencyError) {
        res.status(409).json({ error: err.message });
        return;
      }
      if (err instanceof NotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof ValidationError) {
        res.status(422).json({ error: err.message, field: err.field, constraint: err.constraint });
        return;
      }
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// DELETE /tenants/:tenantId/records/:recordId
recordRouter.delete(
  '/:tenantId/records/:recordId',
  requirePermission('records:write'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const tenantId = req.params['tenantId'] as string;
      const recordId = req.params['recordId'] as string;
      await deleteRecord(tenantId, recordId, req.user?.userId);
      res.status(204).send();
    } catch (err) {
      if (err instanceof NotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// POST /tenants/:tenantId/records/:recordId/restore
recordRouter.post(
  '/:tenantId/records/:recordId/restore',
  requirePermission('records:write'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const tenantId = req.params['tenantId'] as string;
      const recordId = req.params['recordId'] as string;
      const record = await restoreRecord(tenantId, recordId, req.user?.userId);
      res.json(record);
    } catch (err) {
      if (err instanceof NotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);
