/**
 * Auth property tests
 * Feature: universal-data-calibration-platform
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import {
  hashPassword,
  verifyPassword,
  login,
  AuthError,
} from './auth.service';
import { isActionAllowed, PERMISSION_MATRIX, ALL_ACTIONS } from '../middleware/rbac.middleware';
import type { Action } from '../middleware/rbac.middleware';

// Mock pool at module level so auth.service.ts never hits a real DB
vi.mock('../db/pool', () => ({
  pool: {
    query: vi.fn(),
  },
  withTenant: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Property 3: Password Hashing Uniqueness
// Validates: Requirements 2.1
// ---------------------------------------------------------------------------
describe('Property 3: Password Hashing Uniqueness', () => {
  it('hashes differ from plaintext, salts are unique, verify works, cross-verify fails', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        async (p1, p2) => {
          const r1 = await hashPassword(p1);
          const r2 = await hashPassword(p2);

          // hashes differ from plaintext
          expect(r1.hash).not.toBe(p1);
          expect(r2.hash).not.toBe(p2);

          // salts are unique (random 32-byte hex — collision probability negligible)
          expect(r1.salt).not.toBe(r2.salt);

          // verify works
          expect(await verifyPassword(p1, r1.hash, r1.salt)).toBe(true);
          expect(await verifyPassword(p2, r2.hash, r2.salt)).toBe(true);

          // cross-verify fails (salts differ so hashes differ even for equal passwords)
          expect(await verifyPassword(p1, r2.hash, r2.salt)).toBe(false);
        },
      ),
      { numRuns: 20 }, // keep fast — argon2 is slow
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: Invalid Credential Response Indistinguishability
// Validates: Requirements 2.3
// ---------------------------------------------------------------------------
describe('Property 4: Invalid Credential Response Indistinguishability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('user-not-found and wrong-password both throw the same generic error', async () => {
    const { pool } = await import('../db/pool');
    const mockQuery = pool.query as ReturnType<typeof vi.fn>;

    // Scenario A: tenant found, user NOT found
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'tenant-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    let errorA: AuthError | null = null;
    try {
      await login('nonexistent@example.com', 'anypassword', 'tenant-slug');
    } catch (e) {
      errorA = e as AuthError;
    }

    expect(errorA).not.toBeNull();
    expect(errorA).toBeInstanceOf(AuthError);

    // Scenario B: tenant found, user found, wrong password
    // Use a real argon2 hash for a different password so verify returns false
    const { hash: realHash, salt: realSalt } = await hashPassword('correct-password');

    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'tenant-1' }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'user-1',
            password_hash: realHash,
            salt: realSalt,
            role: 'operator',
            is_superadmin: false,
            is_active: true,
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // increment failed_login_attempts

    let errorB: AuthError | null = null;
    try {
      await login('existing@example.com', 'wrongpassword', 'tenant-slug');
    } catch (e) {
      errorB = e as AuthError;
    }

    expect(errorB).not.toBeNull();
    expect(errorB).toBeInstanceOf(AuthError);

    // Both errors must be identical
    expect(errorA!.message).toBe(errorB!.message);

    // Message must not disclose which field was wrong
    const msg = errorA!.message.toLowerCase();
    expect(msg).not.toContain('email');
    expect(msg).not.toContain('password');
    expect(msg).not.toContain('user');
    expect(msg).not.toContain('not found');
  });
});

// ---------------------------------------------------------------------------
// Property 5: RBAC Enforcement
// Validates: Requirements 2.4, 2.5
// ---------------------------------------------------------------------------
describe('Property 5: RBAC Enforcement', () => {
  it('isActionAllowed matches PERMISSION_MATRIX for all role/action combinations', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('admin', 'manager', 'operator'),
        fc.constantFrom(...ALL_ACTIONS),
        (role, action: Action) => {
          const allowed = isActionAllowed(role, action);
          const expected = PERMISSION_MATRIX[role].includes(action);
          expect(allowed).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 34: API Key Rejection
// Validates: Requirements 14.1, 14.3
// ---------------------------------------------------------------------------
describe('Property 34: API Key Rejection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('validateApiKey returns null for invalid/empty/revoked keys', async () => {
    const { validateApiKey } = await import('./api-key.service');
    const { pool } = await import('../db/pool');
    const mockQuery = pool.query as ReturnType<typeof vi.fn>;

    // No active keys in DB
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    const invalidKeys = ['', 'random-invalid-key', 'revoked-key-abc123'];

    for (const key of invalidKeys) {
      const result = await validateApiKey(key);
      expect(result).toBeNull();
    }
  });

  it('AuthMiddleware returns 401 for invalid Bearer token', async () => {
    const mockReq = {
      headers: { authorization: 'Bearer invalid.token.here' },
      user: undefined,
    };
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();

    const { AuthMiddleware } = await import('../middleware/auth.middleware');
    AuthMiddleware(mockReq as never, mockRes as never, next);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    expect(next).not.toHaveBeenCalled();
  });
});
