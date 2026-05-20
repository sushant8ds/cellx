/**
 * Signup, forgot password, and OTP verification routes
 */
import { Router, Request, Response } from 'express';
import { pool } from '../db/pool';
import { hashPassword, generateToken } from './auth.service';
import { generateOtp, verifyOtp, sendOtpEmail } from './otp.service';

export const signupRouter = Router();

// ---------------------------------------------------------------------------
// POST /auth/signup/request-otp
// Step 1: user provides email + tenant slug → send OTP
// ---------------------------------------------------------------------------
signupRouter.post('/signup/request-otp', async (req: Request, res: Response): Promise<void> => {
  const { email, tenantSlug, name } = req.body as { email: string; tenantSlug: string; name?: string };

  if (!email || !tenantSlug) {
    res.status(400).json({ error: 'email and tenantSlug are required' });
    return;
  }

  // Check if tenant exists (or create it if this is the first user = owner signup)
  let tenantResult = await pool.query(
    `SELECT id FROM tenants WHERE slug = $1 AND deleted_at IS NULL`,
    [tenantSlug],
  );

  let tenantId: string;

  if (tenantResult.rows.length === 0) {
    // Create new tenant for this signup
    const newTenant = await pool.query(
      `INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id`,
      [name ?? tenantSlug, tenantSlug],
    );
    tenantId = newTenant.rows[0].id as string;
  } else {
    tenantId = tenantResult.rows[0].id as string;
  }

  // Check if email already registered
  const existing = await pool.query(
    `SELECT id FROM users WHERE tenant_id = $1 AND email = $2`,
    [tenantId, email],
  );
  if (existing.rows.length > 0) {
    res.status(409).json({ error: 'An account with this email already exists for this tenant' });
    return;
  }

  const code = await generateOtp(email, 'signup', tenantId);
  await sendOtpEmail(email, code, 'signup');

  res.json({ message: 'OTP sent to your email', tenantId });
});

// ---------------------------------------------------------------------------
// POST /auth/signup/verify-otp
// Step 2: verify OTP + set password → create user + return token
// ---------------------------------------------------------------------------
signupRouter.post('/signup/verify-otp', async (req: Request, res: Response): Promise<void> => {
  const { email, tenantSlug, code, password, fullName } = req.body as {
    email: string; tenantSlug: string; code: string; password: string; fullName?: string;
  };

  if (!email || !tenantSlug || !code || !password) {
    res.status(400).json({ error: 'email, tenantSlug, code, and password are required' });
    return;
  }

  if (password.length < 8) {
    res.status(422).json({ error: 'Password must be at least 8 characters' });
    return;
  }

  const valid = await verifyOtp(email, code, 'signup');
  if (!valid) {
    res.status(400).json({ error: 'Invalid or expired OTP' });
    return;
  }

  const tenantResult = await pool.query(
    `SELECT id FROM tenants WHERE slug = $1 AND deleted_at IS NULL`,
    [tenantSlug],
  );
  if (tenantResult.rows.length === 0) {
    res.status(404).json({ error: 'Tenant not found' });
    return;
  }
  const tenantId = tenantResult.rows[0].id as string;

  const { hash, salt } = await hashPassword(password);

  // First user in a tenant becomes admin
  const userCount = await pool.query(
    `SELECT COUNT(*) as cnt FROM users WHERE tenant_id = $1`,
    [tenantId],
  );
  const role = parseInt(userCount.rows[0].cnt) === 0 ? 'admin' : 'operator';

  const userResult = await pool.query(
    `INSERT INTO users (tenant_id, email, password_hash, salt, role)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, role, is_superadmin`,
    [tenantId, email, hash, salt, role],
  );
  const user = userResult.rows[0] as { id: string; role: string; is_superadmin: boolean };

  const token = generateToken({
    userId: user.id,
    tenantId,
    role: user.role,
    isSuperadmin: user.is_superadmin,
  });

  res.status(201).json({ token, role: user.role });
});

// ---------------------------------------------------------------------------
// POST /auth/forgot-password/request-otp
// ---------------------------------------------------------------------------
signupRouter.post('/forgot-password/request-otp', async (req: Request, res: Response): Promise<void> => {
  const { email, tenantSlug } = req.body as { email: string; tenantSlug: string };

  if (!email || !tenantSlug) {
    res.status(400).json({ error: 'email and tenantSlug are required' });
    return;
  }

  const tenantResult = await pool.query(
    `SELECT id FROM tenants WHERE slug = $1 AND deleted_at IS NULL`,
    [tenantSlug],
  );
  if (tenantResult.rows.length === 0) {
    // Don't reveal if tenant exists
    res.json({ message: 'If that account exists, an OTP has been sent' });
    return;
  }
  const tenantId = tenantResult.rows[0].id as string;

  const userResult = await pool.query(
    `SELECT id FROM users WHERE tenant_id = $1 AND email = $2 AND is_active = true`,
    [tenantId, email],
  );
  if (userResult.rows.length === 0) {
    res.json({ message: 'If that account exists, an OTP has been sent' });
    return;
  }

  const code = await generateOtp(email, 'reset_password', tenantId);
  await sendOtpEmail(email, code, 'reset_password');

  res.json({ message: 'If that account exists, an OTP has been sent' });
});

// ---------------------------------------------------------------------------
// POST /auth/forgot-password/reset
// ---------------------------------------------------------------------------
signupRouter.post('/forgot-password/reset', async (req: Request, res: Response): Promise<void> => {
  const { email, tenantSlug, code, newPassword } = req.body as {
    email: string; tenantSlug: string; code: string; newPassword: string;
  };

  if (!email || !tenantSlug || !code || !newPassword) {
    res.status(400).json({ error: 'email, tenantSlug, code, and newPassword are required' });
    return;
  }

  if (newPassword.length < 8) {
    res.status(422).json({ error: 'Password must be at least 8 characters' });
    return;
  }

  const valid = await verifyOtp(email, code, 'reset_password');
  if (!valid) {
    res.status(400).json({ error: 'Invalid or expired OTP' });
    return;
  }

  const tenantResult = await pool.query(
    `SELECT id FROM tenants WHERE slug = $1 AND deleted_at IS NULL`,
    [tenantSlug],
  );
  if (tenantResult.rows.length === 0) {
    res.status(404).json({ error: 'Tenant not found' });
    return;
  }
  const tenantId = tenantResult.rows[0].id as string;

  const { hash, salt } = await hashPassword(newPassword);

  await pool.query(
    `UPDATE users SET password_hash = $1, salt = $2, failed_login_attempts = 0
     WHERE tenant_id = $3 AND email = $4`,
    [hash, salt, tenantId, email],
  );

  res.json({ message: 'Password reset successfully. You can now sign in.' });
});
