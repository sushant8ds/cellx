import { Router, Request, Response } from 'express';
import { AuthMiddleware, TenantIsolationMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { generateApiKey, rotateApiKey, revokeApiKey } from './api-key.service';
import { Role } from './auth.service';
import { pool } from '../db/pool';

export const apiKeyRouter = Router();

const guard = [AuthMiddleware, TenantIsolationMiddleware, requirePermission('api-keys:manage')];

// GET /tenants/:tenantId/api-keys
apiKeyRouter.get('/:tenantId/api-keys', ...guard, async (req: Request, res: Response) => {
  const tenantId = req.params['tenantId'] as string;
  const result = await pool.query(
    `SELECT id, name, role, is_active, last_used, created_at, revoked_at
     FROM api_keys WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [tenantId],
  );
  res.json(result.rows);
});

// POST /tenants/:tenantId/api-keys
apiKeyRouter.post('/:tenantId/api-keys', ...guard, async (req: Request, res: Response) => {
  const tenantId = req.params['tenantId'] as string;
  const { name, role } = req.body as { name: string; role: Role };

  if (!name || !role) {
    res.status(400).json({ error: 'name and role are required' });
    return;
  }

  try {
    const apiKey = await generateApiKey(tenantId, name, role);
    res.status(201).json(apiKey);
  } catch {
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

// POST /tenants/:tenantId/api-keys/:keyId/rotate
apiKeyRouter.post('/:tenantId/api-keys/:keyId/rotate', ...guard, async (req: Request, res: Response) => {
  const tenantId = req.params['tenantId'] as string;
  const keyId = req.params['keyId'] as string;
  try {
    const result = await rotateApiKey(keyId, tenantId);
    res.json(result);
  } catch {
    res.status(404).json({ error: 'API key not found' });
  }
});

// DELETE /tenants/:tenantId/api-keys/:keyId
apiKeyRouter.delete('/:tenantId/api-keys/:keyId', ...guard, async (req: Request, res: Response) => {
  const tenantId = req.params['tenantId'] as string;
  const keyId = req.params['keyId'] as string;
  await revokeApiKey(keyId, tenantId);
  res.status(204).send();
});
