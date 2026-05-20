import { Pool, PoolClient } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from the package directory — safe to call multiple times
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is not set. Make sure packages/api/.env exists with DATABASE_URL=postgresql://...',
  );
}

export const pool = new Pool({ connectionString: databaseUrl });

export async function withTenant<T>(
  tenantId: string | null,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (tenantId !== null) {
      if (!/^[0-9a-f-]{36}$/.test(tenantId)) throw new Error('Invalid tenantId');
      await client.query(`SET LOCAL app.current_tenant_id = '${tenantId}'`);
    }
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
