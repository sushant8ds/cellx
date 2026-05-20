/**
 * OTP Service — generates and verifies one-time codes for signup and password reset
 */
import { randomInt } from 'crypto';
import { createTransport } from 'nodemailer';
import { pool } from '../db/pool';
import { logger } from '../middleware/logging.middleware';

export type OtpPurpose = 'signup' | 'reset_password';

export async function generateOtp(email: string, purpose: OtpPurpose, tenantId?: string): Promise<string> {
  const code = String(randomInt(100000, 999999));

  // Invalidate any existing unused OTPs for this email+purpose
  await pool.query(
    `UPDATE otp_codes SET used_at = now() WHERE email = $1 AND purpose = $2 AND used_at IS NULL`,
    [email, purpose],
  );

  await pool.query(
    `INSERT INTO otp_codes (email, tenant_id, code, purpose) VALUES ($1, $2, $3, $4)`,
    [email, tenantId ?? null, code, purpose],
  );

  return code;
}

export async function verifyOtp(email: string, code: string, purpose: OtpPurpose): Promise<boolean> {
  const result = await pool.query(
    `UPDATE otp_codes
     SET used_at = now()
     WHERE email = $1 AND code = $2 AND purpose = $3
       AND used_at IS NULL AND expires_at > now()
     RETURNING id`,
    [email, code, purpose],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function sendOtpEmail(email: string, code: string, purpose: OtpPurpose): Promise<void> {
  const subject = purpose === 'signup' ? 'Your UDCP verification code' : 'Your UDCP password reset code';
  const body = `
Your ${purpose === 'signup' ? 'signup verification' : 'password reset'} code is:

  ${code}

This code expires in 15 minutes. Do not share it with anyone.

— UDCP Platform
  `.trim();

  // Always log to console for debugging
  console.log(`\n========================================`);
  console.log(`📧 OTP for ${email}: ${code}`);
  console.log(`========================================\n`);
  logger.info({ msg: 'OTP generated', to: email, purpose });

  // Send real email if SMTP is configured
  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (smtpHost && smtpUser && smtpPass) {
    try {
      const transporter = createTransport({
        host: smtpHost,
        port: parseInt(process.env.SMTP_PORT ?? '587'),
        secure: false,
        auth: { user: smtpUser, pass: smtpPass },
      });

      await transporter.sendMail({
        from: `"UDCP Platform" <${process.env.SMTP_FROM ?? smtpUser}>`,
        to: email,
        subject,
        text: body,
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
            <h2 style="color:#2563eb">UDCP Platform</h2>
            <p>Your ${purpose === 'signup' ? 'signup verification' : 'password reset'} code is:</p>
            <div style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#111;background:#f3f4f6;padding:16px 24px;border-radius:8px;text-align:center;margin:24px 0">
              ${code}
            </div>
            <p style="color:#6b7280;font-size:13px">This code expires in 15 minutes. Do not share it with anyone.</p>
          </div>
        `,
      });

      logger.info({ msg: 'OTP email sent', to: email });
    } catch (err) {
      logger.error({ msg: 'Failed to send OTP email', err });
      // Don't throw — OTP is still valid, user can get it from console
    }
  }
}
