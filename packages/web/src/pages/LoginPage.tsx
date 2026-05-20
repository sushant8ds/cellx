import React, { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useAuth } from '../lib/auth';

type View = 'signin' | 'signup' | 'forgot' | 'verify-signup' | 'verify-reset';

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', border: '1px solid #d1d5db',
  borderRadius: 6, fontSize: 14, boxSizing: 'border-box', outline: 'none',
};
const btnPrimary: React.CSSProperties = {
  width: '100%', padding: '10px', background: '#2563eb', color: '#fff',
  border: 'none', borderRadius: 6, fontSize: 15, cursor: 'pointer', fontWeight: 600,
};
const btnSecondary: React.CSSProperties = {
  background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer',
  fontSize: 13, padding: 0, textDecoration: 'underline',
};
const field: React.CSSProperties = { marginBottom: 14 };
const label: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4, color: '#374151' };
const errStyle: React.CSSProperties = { color: '#dc2626', fontSize: 13, marginBottom: 10 };
const successStyle: React.CSSProperties = { color: '#16a34a', fontSize: 13, marginBottom: 10 };

export default function LoginPage() {
  const [view, setView] = useState<View>('signin');
  const [tenantSlug, setTenantSlug] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  function reset() { setError(''); setSuccess(''); setOtp(''); }

  // ── Sign In ──────────────────────────────────────────────────────────────
  async function handleSignIn(e: FormEvent) {
    e.preventDefault(); reset(); setLoading(true);
    try {
      const { data } = await api.post<{ token: string }>('/auth/login', { email, password, tenantSlug });
      login(data.token);
      navigate('/dashboard');
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Invalid credentials');
    } finally { setLoading(false); }
  }

  // ── Sign Up Step 1: request OTP ──────────────────────────────────────────
  async function handleSignupRequestOtp(e: FormEvent) {
    e.preventDefault(); reset(); setLoading(true);
    try {
      await api.post('/auth/signup/request-otp', { email, tenantSlug, name: fullName || tenantSlug });
      setSuccess(`OTP sent to ${email}. Check your inbox (or server logs in dev mode).`);
      setView('verify-signup');
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to send OTP');
    } finally { setLoading(false); }
  }

  // ── Sign Up Step 2: verify OTP + set password ────────────────────────────
  async function handleSignupVerify(e: FormEvent) {
    e.preventDefault(); reset();
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    setLoading(true);
    try {
      const { data } = await api.post<{ token: string }>('/auth/signup/verify-otp', {
        email, tenantSlug, code: otp, password, fullName,
      });
      login(data.token);
      navigate('/dashboard');
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Invalid OTP');
    } finally { setLoading(false); }
  }

  // ── Forgot Password Step 1: request OTP ─────────────────────────────────
  async function handleForgotRequestOtp(e: FormEvent) {
    e.preventDefault(); reset(); setLoading(true);
    try {
      await api.post('/auth/forgot-password/request-otp', { email, tenantSlug });
      setSuccess('If that account exists, an OTP has been sent to your email.');
      setView('verify-reset');
    } catch { setSuccess('If that account exists, an OTP has been sent to your email.'); setView('verify-reset'); }
    finally { setLoading(false); }
  }

  // ── Forgot Password Step 2: verify OTP + new password ───────────────────
  async function handleResetPassword(e: FormEvent) {
    e.preventDefault(); reset();
    if (newPassword.length < 8) { setError('Password must be at least 8 characters'); return; }
    setLoading(true);
    try {
      await api.post('/auth/forgot-password/reset', { email, tenantSlug, code: otp, newPassword });
      setSuccess('Password reset! You can now sign in.');
      setTimeout(() => { setView('signin'); setSuccess(''); }, 2000);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Invalid OTP');
    } finally { setLoading(false); }
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: 'linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%)' }}>
      <div style={{ background: '#fff', padding: '32px 36px', borderRadius: 12, boxShadow: '0 4px 24px rgba(0,0,0,0.10)', width: 400 }}>

        {/* Logo / Title */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 28, marginBottom: 4 }}>⚙️</div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#111827' }}>UDCP Platform</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>Universal Data & Calibration</p>
        </div>

        {/* Tab bar */}
        {(view === 'signin' || view === 'signup') && (
          <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb', marginBottom: 20 }}>
            {(['signin', 'signup'] as const).map(v => (
              <button key={v} onClick={() => { setView(v); reset(); }}
                style={{ flex: 1, padding: '8px 0', border: 'none', background: 'none', cursor: 'pointer', fontWeight: view === v ? 700 : 400, color: view === v ? '#2563eb' : '#6b7280', borderBottom: view === v ? '2px solid #2563eb' : '2px solid transparent', fontSize: 14 }}>
                {v === 'signin' ? 'Sign In' : 'Sign Up'}
              </button>
            ))}
          </div>
        )}

        {/* Back link for sub-views */}
        {(view === 'forgot' || view === 'verify-signup' || view === 'verify-reset') && (
          <button onClick={() => { setView(view === 'verify-signup' ? 'signup' : view === 'verify-reset' ? 'forgot' : 'signin'); reset(); }} style={{ ...btnSecondary, marginBottom: 16, display: 'block' }}>
            ← Back
          </button>
        )}

        {error && <div style={errStyle}>{error}</div>}
        {success && <div style={successStyle}>{success}</div>}

        {/* ── SIGN IN ── */}
        {view === 'signin' && (
          <form onSubmit={handleSignIn}>
            <div style={field}>
              <label style={label}>Workspace / Tenant</label>
              <input style={inputStyle} type="text" placeholder="your-company" value={tenantSlug} onChange={e => setTenantSlug(e.target.value)} required />
            </div>
            <div style={field}>
              <label style={label}>Email</label>
              <input style={inputStyle} type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div style={{ ...field, marginBottom: 6 }}>
              <label style={label}>Password</label>
              <input style={inputStyle} type="password" value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            <div style={{ textAlign: 'right', marginBottom: 16 }}>
              <button type="button" style={btnSecondary} onClick={() => { setView('forgot'); reset(); }}>Forgot password?</button>
            </div>
            <button type="submit" style={btnPrimary} disabled={loading}>{loading ? 'Signing in…' : 'Sign In'}</button>
          </form>
        )}

        {/* ── SIGN UP ── */}
        {view === 'signup' && (
          <form onSubmit={handleSignupRequestOtp}>
            <div style={field}>
              <label style={label}>Workspace Name</label>
              <input style={inputStyle} type="text" placeholder="my-company" value={tenantSlug} onChange={e => setTenantSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} required />
              <span style={{ fontSize: 11, color: '#9ca3af' }}>Lowercase letters, numbers, hyphens only</span>
            </div>
            <div style={field}>
              <label style={label}>Your Name</label>
              <input style={inputStyle} type="text" placeholder="John Doe" value={fullName} onChange={e => setFullName(e.target.value)} />
            </div>
            <div style={field}>
              <label style={label}>Email</label>
              <input style={inputStyle} type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <button type="submit" style={btnPrimary} disabled={loading}>{loading ? 'Sending OTP…' : 'Continue →'}</button>
          </form>
        )}

        {/* ── VERIFY SIGNUP OTP ── */}
        {view === 'verify-signup' && (
          <form onSubmit={handleSignupVerify}>
            <p style={{ fontSize: 13, color: '#374151', marginBottom: 16 }}>Enter the 6-digit code sent to <strong>{email}</strong></p>
            <div style={field}>
              <label style={label}>Verification Code</label>
              <input style={{ ...inputStyle, letterSpacing: 8, fontSize: 20, textAlign: 'center' }} type="text" maxLength={6} placeholder="000000" value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ''))} required />
            </div>
            <div style={field}>
              <label style={label}>Password</label>
              <input style={inputStyle} type="password" placeholder="Min 8 characters" value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            <div style={field}>
              <label style={label}>Confirm Password</label>
              <input style={inputStyle} type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required />
            </div>
            <button type="submit" style={btnPrimary} disabled={loading}>{loading ? 'Creating account…' : 'Create Account'}</button>
            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <button type="button" style={btnSecondary} onClick={handleSignupRequestOtp} disabled={loading}>Resend code</button>
            </div>
          </form>
        )}

        {/* ── FORGOT PASSWORD ── */}
        {view === 'forgot' && (
          <form onSubmit={handleForgotRequestOtp}>
            <p style={{ fontSize: 13, color: '#374151', marginBottom: 16 }}>Enter your workspace and email to receive a reset code.</p>
            <div style={field}>
              <label style={label}>Workspace</label>
              <input style={inputStyle} type="text" placeholder="your-company" value={tenantSlug} onChange={e => setTenantSlug(e.target.value)} required />
            </div>
            <div style={field}>
              <label style={label}>Email</label>
              <input style={inputStyle} type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <button type="submit" style={btnPrimary} disabled={loading}>{loading ? 'Sending…' : 'Send Reset Code'}</button>
          </form>
        )}

        {/* ── VERIFY RESET OTP ── */}
        {view === 'verify-reset' && (
          <form onSubmit={handleResetPassword}>
            <p style={{ fontSize: 13, color: '#374151', marginBottom: 16 }}>Enter the code sent to <strong>{email}</strong> and your new password.</p>
            <div style={field}>
              <label style={label}>Reset Code</label>
              <input style={{ ...inputStyle, letterSpacing: 8, fontSize: 20, textAlign: 'center' }} type="text" maxLength={6} placeholder="000000" value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ''))} required />
            </div>
            <div style={field}>
              <label style={label}>New Password</label>
              <input style={inputStyle} type="password" placeholder="Min 8 characters" value={newPassword} onChange={e => setNewPassword(e.target.value)} required />
            </div>
            <button type="submit" style={btnPrimary} disabled={loading}>{loading ? 'Resetting…' : 'Reset Password'}</button>
          </form>
        )}

        {/* Footer */}
        <p style={{ textAlign: 'center', fontSize: 12, color: '#9ca3af', marginTop: 20, marginBottom: 0 }}>
          Universal Data & Calibration Platform
        </p>
      </div>
    </div>
  );
}
