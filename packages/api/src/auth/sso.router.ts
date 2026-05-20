import { Router, Request, Response } from 'express';
import { pool } from '../db/pool';
import { generateToken, Role } from './auth.service';
import { logger } from '../middleware/logging.middleware';

export const ssoRouter = Router();

interface SsoConfig {
  roleMapping?: Record<string, Role>;
  [key: string]: unknown;
}

async function handleSsoCallback(
  tenantSlug: string,
  email: string,
  groups: string[],
  res: Response,
): Promise<void> {
  try {
    // Load tenant and sso_config
    const tenantResult = await pool.query(
      'SELECT id, sso_config FROM tenants WHERE slug = $1 AND deleted_at IS NULL',
      [tenantSlug],
    );

    if (tenantResult.rows.length === 0) {
      res.status(400).json({ error: 'Unknown tenant' });
      return;
    }

    const tenant = tenantResult.rows[0] as { id: string; sso_config: SsoConfig | null };
    const ssoConfig: SsoConfig = tenant.sso_config ?? {};
    const roleMapping = ssoConfig.roleMapping ?? {};

    // Map IdP group claims to platform role
    let role: Role = 'operator';
    for (const group of groups) {
      if (roleMapping[group]) {
        role = roleMapping[group];
        break;
      }
    }

    // Upsert user
    const upsertResult = await pool.query(
      `INSERT INTO users (tenant_id, email, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, email)
       DO UPDATE SET role = EXCLUDED.role
       RETURNING id, role, is_superadmin`,
      [tenant.id, email, role],
    );

    const user = upsertResult.rows[0] as { id: string; role: Role; is_superadmin: boolean };

    const token = generateToken({
      userId: user.id,
      tenantId: tenant.id,
      role: user.role,
      isSuperadmin: user.is_superadmin,
    });

    res.json({ token });
  } catch (err) {
    logger.error({ err, msg: 'SSO callback error' });
    res.status(500).json({ error: 'Internal server error' });
  }
}

// POST /auth/sso/saml — SAML 2.0 callback
ssoRouter.post('/saml', async (req: Request, res: Response) => {
  const tenantSlug = (req.query['tenant'] as string) || '';
  // In production, passport-saml would parse the SAMLResponse and populate req.user
  // Here we use a minimal placeholder that reads from req.body for structural correctness
  const { email = '', groups = [] } = req.body as { email?: string; groups?: string[] };

  if (!tenantSlug || !email) {
    res.status(400).json({ error: 'tenant and email are required' });
    return;
  }

  await handleSsoCallback(tenantSlug, email, groups, res);
});

// POST /auth/sso/oauth2/callback — OAuth 2.0 callback
ssoRouter.post('/oauth2/callback', async (req: Request, res: Response) => {
  const tenantSlug = (req.query['tenant'] as string) || '';
  const { email = '', groups = [] } = req.body as { email?: string; groups?: string[] };

  if (!tenantSlug || !email) {
    res.status(400).json({ error: 'tenant and email are required' });
    return;
  }

  await handleSsoCallback(tenantSlug, email, groups, res);
});
