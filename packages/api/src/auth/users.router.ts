import { Router, Request, Response } from 'express';
import { AuthMiddleware, TenantIsolationMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { hashPassword, Role } from './auth.service';
import { pool } from '../db/pool';

export const usersRouter = Router();

const guard = [AuthMiddleware, TenantIsolationMiddleware, requirePermission('users:manage')];

// POST /tenants/:tenantId/users — create user (admin only)
usersRouter.post('/:tenantId/users', ...guard, async (req: Request, res: Response) => {
  const tenantId = req.params['tenantId'] as string;
  const { email, password, role } = req.body as {
    email: string;
    password: string;
    role: Role;
  };

  if (!email || !role) {
    res.status(400).json({ error: 'email and role are required' });
    return;
  }

  try {
    let passwordHash: string | null = null;
    let salt: string | null = null;

    if (password) {
      const hashed = await hashPassword(password);
      passwordHash = hashed.hash;
      salt = hashed.salt;
    }

    const result = await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, salt, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, role, is_active, created_at`,
      [tenantId, email, passwordHash, salt, role],
    );

    res.status(201).json(result.rows[0]);
  } catch (err: unknown) {
    const pgErr = err as { code?: string };
    if (pgErr.code === '23505') {
      res.status(409).json({ error: 'User already exists' });
      return;
    }
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// PATCH /tenants/:tenantId/users/:userId — update role or deactivate
usersRouter.patch(
  '/:tenantId/users/:userId',
  ...guard,
  async (req: Request, res: Response) => {
    const tenantId = req.params['tenantId'] as string;
    const userId = req.params['userId'] as string;
    const { role, is_active } = req.body as { role?: Role; is_active?: boolean };

    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (role !== undefined) {
      updates.push(`role = $${idx++}`);
      values.push(role);
    }
    if (is_active !== undefined) {
      updates.push(`is_active = $${idx++}`);
      values.push(is_active);
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    values.push(userId, tenantId);
    const result = await pool.query(
      `UPDATE users SET ${updates.join(', ')}
       WHERE id = $${idx++} AND tenant_id = $${idx}
       RETURNING id, email, role, is_active`,
      values,
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json(result.rows[0]);
  },
);

// GET /tenants/:tenantId/users — list users in tenant
usersRouter.get('/:tenantId/users', ...guard, async (req: Request, res: Response) => {
  const tenantId = req.params['tenantId'] as string;
  const result = await pool.query(
    `SELECT id, email, role, is_active, created_at
     FROM users WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [tenantId],
  );
  res.json(result.rows);
});
