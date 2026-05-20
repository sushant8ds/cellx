import * as argon2 from 'argon2';
import * as jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { pool } from '../db/pool';

export type Role = 'admin' | 'manager' | 'operator';

export interface TokenPayload {
  userId: string;
  tenantId: string;
  role: Role;
  isSuperadmin: boolean;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export async function hashPassword(plain: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(32).toString('hex');
  const hash = await argon2.hash(plain + salt);
  return { hash, salt };
}

export async function verifyPassword(plain: string, hash: string, salt: string): Promise<boolean> {
  return argon2.verify(hash, plain + salt);
}

export function generateToken(payload: {
  userId: string;
  tenantId: string;
  role: string;
  isSuperadmin: boolean;
}): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, {
    expiresIn: (process.env.JWT_EXPIRES_IN || '8h') as jwt.SignOptions['expiresIn'],
  });
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, process.env.JWT_SECRET!) as TokenPayload;
}

export async function login(
  email: string,
  password: string,
  tenantSlug: string,
): Promise<{ token: string }> {
  // Look up tenant by slug (no RLS needed)
  const tenantResult = await pool.query(
    'SELECT id FROM tenants WHERE slug = $1 AND deleted_at IS NULL',
    [tenantSlug],
  );
  if (tenantResult.rows.length === 0) {
    throw new AuthError('Invalid credentials');
  }
  const tenantId = tenantResult.rows[0].id as string;

  // Look up user by (tenant_id, email)
  const userResult = await pool.query(
    'SELECT id, password_hash, salt, role, is_superadmin, is_active, failed_login_attempts FROM users WHERE tenant_id = $1 AND email = $2',
    [tenantId, email],
  );

  const user = userResult.rows[0];

  if (!user) {
    throw new AuthError('Invalid credentials');
  }

  // Enforce account lockout: reject if too many failed attempts
  const maxFailedAttempts = parseInt(process.env.MAX_FAILED_LOGIN_ATTEMPTS ?? '5', 10);
  if ((user.failed_login_attempts ?? 0) >= maxFailedAttempts) {
    throw new AuthError('Invalid credentials');
  }

  const passwordValid =
    user.password_hash && user.salt
      ? await verifyPassword(password, user.password_hash, user.salt)
      : false;

  if (!passwordValid) {
    // Increment failed_login_attempts
    await pool.query(
      'UPDATE users SET failed_login_attempts = failed_login_attempts + 1 WHERE id = $1',
      [user.id],
    );
    throw new AuthError('Invalid credentials');
  }

  // Reset failed_login_attempts on success
  await pool.query('UPDATE users SET failed_login_attempts = 0 WHERE id = $1', [user.id]);

  const token = generateToken({
    userId: user.id as string,
    tenantId,
    role: user.role as string,
    isSuperadmin: user.is_superadmin as boolean,
  });

  return { token };
}
