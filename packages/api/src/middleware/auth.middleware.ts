import { Request, Response, NextFunction } from 'express';
import { PoolClient } from 'pg';
import { verifyToken, TokenPayload } from '../auth/auth.service';
import { logger } from './logging.middleware';

// Extend Express Request to carry user payload
declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
      traceId?: string;
    }
  }
}

export function AuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

export function TenantIsolationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const { tenantId } = req.params;

  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // Superadmins bypass tenant isolation
  if (req.user.isSuperadmin) {
    next();
    return;
  }

  if (tenantId && tenantId !== req.user.tenantId) {
    logger.warn({
      msg: 'Tenant isolation violation',
      traceId: req.traceId,
      userId: req.user.userId,
      requestedTenantId: tenantId,
      sessionTenantId: req.user.tenantId,
    });
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  next();
}

export async function setTenantContext(client: PoolClient, tenantId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/.test(tenantId)) throw new Error('Invalid tenantId');
  await client.query(`SET LOCAL app.current_tenant_id = '${tenantId}'`);
}
