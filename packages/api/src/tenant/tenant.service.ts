import { pool } from '../db/pool';

export type Tenant = {
  id: string;
  name: string;
  slug: string;
  sso_config: unknown;
  created_at: Date;
};

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export async function createTenant(name: string, slug: string): Promise<Tenant> {
  try {
    const result = await pool.query<Tenant>(
      `INSERT INTO tenants (name, slug) VALUES ($1, $2)
       RETURNING id, name, slug, sso_config, created_at`,
      [name, slug],
    );
    return result.rows[0];
  } catch (err: unknown) {
    if ((err as { code?: string }).code === '23505') {
      throw new ConflictError(`Tenant with slug '${slug}' already exists`);
    }
    throw err;
  }
}

export async function getTenantBySlug(slug: string): Promise<Tenant | null> {
  const result = await pool.query<Tenant>(
    `SELECT id, name, slug, sso_config, created_at
     FROM tenants WHERE slug = $1 AND deleted_at IS NULL`,
    [slug],
  );
  return result.rows[0] ?? null;
}

export async function getTenantById(id: string): Promise<Tenant | null> {
  const result = await pool.query<Tenant>(
    `SELECT id, name, slug, sso_config, created_at
     FROM tenants WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return result.rows[0] ?? null;
}
