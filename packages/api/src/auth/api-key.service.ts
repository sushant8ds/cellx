import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { pool } from '../db/pool';
import { TokenPayload, Role } from './auth.service';

export interface ApiKeyRecord {
  id: string;
  rawKey: string;
  name: string;
  role: Role;
}

export async function generateApiKey(
  tenantId: string,
  name: string,
  role: Role,
): Promise<ApiKeyRecord> {
  const rawKey = randomBytes(32).toString('hex');
  const keyHash = await argon2.hash(rawKey);

  const result = await pool.query(
    `INSERT INTO api_keys (tenant_id, key_hash, name, role)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, role`,
    [tenantId, keyHash, name, role],
  );

  const row = result.rows[0] as { id: string; name: string; role: Role };
  return { id: row.id, rawKey, name: row.name, role: row.role };
}

export async function validateApiKey(rawKey: string): Promise<TokenPayload | null> {
  // Fetch all active, non-revoked keys for the tenant (we must verify each hash)
  const result = await pool.query(
    `SELECT id, tenant_id, key_hash, role, is_active, revoked_at
     FROM api_keys
     WHERE is_active = true AND revoked_at IS NULL`,
  );

  for (const row of result.rows as Array<{
    id: string;
    tenant_id: string;
    key_hash: string;
    role: Role;
    is_active: boolean;
    revoked_at: string | null;
  }>) {
    const matches = await argon2.verify(row.key_hash, rawKey);
    if (matches) {
      // Update last_used
      await pool.query('UPDATE api_keys SET last_used = now() WHERE id = $1', [row.id]);
      return {
        userId: row.id,
        tenantId: row.tenant_id,
        role: row.role,
        isSuperadmin: false,
      };
    }
  }

  return null;
}

export async function rotateApiKey(
  keyId: string,
  tenantId: string,
): Promise<{ rawKey: string }> {
  const rawKey = randomBytes(32).toString('hex');
  const keyHash = await argon2.hash(rawKey);

  const result = await pool.query(
    `UPDATE api_keys SET key_hash = $1, revoked_at = NULL, is_active = true
     WHERE id = $2 AND tenant_id = $3
     RETURNING id`,
    [keyHash, keyId, tenantId],
  );

  if (result.rowCount === 0) {
    throw new Error('API key not found');
  }

  return { rawKey };
}

export async function revokeApiKey(keyId: string, tenantId: string): Promise<void> {
  await pool.query(
    `UPDATE api_keys SET revoked_at = now(), is_active = false
     WHERE id = $1 AND tenant_id = $2`,
    [keyId, tenantId],
  );
}
