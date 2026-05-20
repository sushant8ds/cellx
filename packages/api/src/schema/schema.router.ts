/**
 * Schema router — dynamic field management
 * Feature: universal-data-calibration-platform
 */
import { Router, Request, Response } from 'express';
import { AuthMiddleware, TenantIsolationMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import {
  addField,
  getSchema,
  renameField,
  deleteField,
  SchemaError,
  ConflictError,
  NotFoundError,
} from './schema.service';

export const schemaRouter = Router();

// GET /tenants/:tenantId/schema
schemaRouter.get(
  '/:tenantId/schema',
  AuthMiddleware,
  TenantIsolationMiddleware,
  requirePermission('records:read'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const fields = await getSchema(req.params['tenantId'] as string);
      res.json(fields);
    } catch (err) {
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// POST /tenants/:tenantId/schema/fields
schemaRouter.post(
  '/:tenantId/schema/fields',
  AuthMiddleware,
  TenantIsolationMiddleware,
  requirePermission('schema:write'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const field = await addField(req.params['tenantId'] as string, req.body);
      res.status(201).json(field);
    } catch (err) {
      if (err instanceof ConflictError) {
        res.status(409).json({ error: err.message });
        return;
      }
      if (err instanceof SchemaError) {
        res.status(422).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// PATCH /tenants/:tenantId/schema/fields/:fieldId
schemaRouter.patch(
  '/:tenantId/schema/fields/:fieldId',
  AuthMiddleware,
  TenantIsolationMiddleware,
  requirePermission('schema:write'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { name } = req.body as { name: string };
      const field = await renameField(req.params['tenantId'] as string, req.params['fieldId'] as string, name);
      res.json(field);
    } catch (err) {
      if (err instanceof NotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof ConflictError) {
        res.status(409).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// DELETE /tenants/:tenantId/schema/fields/:fieldId
schemaRouter.delete(
  '/:tenantId/schema/fields/:fieldId',
  AuthMiddleware,
  TenantIsolationMiddleware,
  requirePermission('schema:write'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await deleteField(req.params['tenantId'] as string, req.params['fieldId'] as string);
      res.json(result);
    } catch (err) {
      if (err instanceof NotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);
