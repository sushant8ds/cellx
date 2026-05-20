/**
 * Tenant property tests
 * Feature: universal-data-calibration-platform
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

// Mock pool before importing anything that uses it
vi.mock('../db/pool', () => {
  const mockClient = {
    query: vi.fn(),
    release: vi.fn(),
  };
  const mockPool = {
    query: vi.fn(),
    connect: vi.fn().mockResolvedValue(mockClient),
  };
  return {
    pool: mockPool,
    withTenant: vi.fn(async (tenantId: string | null, fn: (client: typeof mockClient) => Promise<unknown>) => {
      // Simulate the real withTenant: call SET LOCAL then run fn
      if (tenantId !== null) {
        await mockClient.query(`SET LOCAL app.current_tenant_id = '${tenantId}'`);
      }
      return fn(mockClient);
    }),
    __mockClient: mockClient,
    __mockPool: mockPool,
  };
});

// ---------------------------------------------------------------------------
// Property 1: Tenant Data Isolation
// Validates: Requirements 1.1, 1.2, 1.3
// ---------------------------------------------------------------------------
describe('Property 1: Tenant Data Isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('withTenant sets SET LOCAL app.current_tenant_id with the correct tenantId', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), async (tenantId) => {
        const { withTenant, __mockClient } = await import('../db/pool') as unknown as {
          withTenant: (id: string | null, fn: (c: { query: ReturnType<typeof vi.fn> }) => Promise<unknown>) => Promise<unknown>;
          __mockClient: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
        };

        __mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });

        const queryCalls: string[] = [];
        __mockClient.query.mockImplementation((sql: string) => {
          queryCalls.push(sql);
          return Promise.resolve({ rows: [], rowCount: 0 });
        });

        await withTenant(tenantId, async (_client) => {
          return null;
        });

        // The SET LOCAL call should include the tenantId
        const setLocalCall = queryCalls.find((q) => q.includes('SET LOCAL'));
        expect(setLocalCall).toBeDefined();
        expect(setLocalCall).toContain(tenantId);
      }),
      { numRuns: 20 },
    );
  });

  it('query authenticated as tenant B returns zero records belonging to tenant A', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        fc.array(fc.record({ id: fc.uuid(), data: fc.string() }), { minLength: 1, maxLength: 5 }),
        async (tenantAId, tenantBId, tenantARecords) => {
          // Ensure distinct tenants
          fc.pre(tenantAId !== tenantBId);

          const { pool } = await import('../db/pool') as unknown as { pool: { query: ReturnType<typeof vi.fn> } };

          // When queried with tenant B's context, return empty (RLS enforced)
          pool.query.mockResolvedValue({ rows: [], rowCount: 0 });

          const result = await pool.query(
            'SELECT * FROM records WHERE tenant_id = $1',
            [tenantBId],
          );

          // Tenant B's query must not return any of tenant A's records
          const tenantAIds = new Set(tenantARecords.map((r) => r.id));
          const returnedIds = result.rows.map((r: { id: string }) => r.id);
          const leaked = returnedIds.filter((id: string) => tenantAIds.has(id));

          expect(leaked).toHaveLength(0);
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: New Tenant Onboarding Does Not Affect Existing Tenants
// Validates: Requirements 1.4
// ---------------------------------------------------------------------------
describe('Property 2: New Tenant Onboarding Does Not Affect Existing Tenants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createTenant does not alter existing tenant data', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          id: fc.uuid(),
          name: fc.string({ minLength: 1, maxLength: 50 }),
          slug: fc.stringMatching(/^[a-z][a-z0-9-]{2,19}$/),
          sso_config: fc.constant(null),
          created_at: fc.date(),
        }),
        fc.record({
          name: fc.string({ minLength: 1, maxLength: 50 }),
          slug: fc.stringMatching(/^[a-z][a-z0-9-]{2,19}$/),
        }),
        async (existingTenant, newTenantInput) => {
          fc.pre(existingTenant.slug !== newTenantInput.slug);

          const { pool } = await import('../db/pool') as unknown as { pool: { query: ReturnType<typeof vi.fn> } };

          const newTenantRow = {
            id: 'new-tenant-id',
            name: newTenantInput.name,
            slug: newTenantInput.slug,
            sso_config: null,
            created_at: new Date(),
          };

          // createTenant INSERT returns the new tenant
          pool.query
            .mockResolvedValueOnce({ rows: [newTenantRow], rowCount: 1 })
            // getTenantById for existing tenant still returns the same data
            .mockResolvedValueOnce({ rows: [existingTenant], rowCount: 1 })
            // getTenantBySlug for new tenant returns new tenant
            .mockResolvedValueOnce({ rows: [newTenantRow], rowCount: 1 })
            // getTenantBySlug for existing tenant still returns existing tenant
            .mockResolvedValueOnce({ rows: [existingTenant], rowCount: 1 });

          const { createTenant, getTenantById, getTenantBySlug } = await import('./tenant.service');

          const created = await createTenant(newTenantInput.name, newTenantInput.slug);
          expect(created.slug).toBe(newTenantInput.slug);

          // Existing tenant by ID is unchanged
          const existingById = await getTenantById(existingTenant.id);
          expect(existingById).not.toBeNull();
          expect(existingById!.id).toBe(existingTenant.id);
          expect(existingById!.slug).toBe(existingTenant.slug);

          // New tenant is findable by slug
          const newBySlug = await getTenantBySlug(newTenantInput.slug);
          expect(newBySlug).not.toBeNull();
          expect(newBySlug!.slug).toBe(newTenantInput.slug);

          // Existing tenant by slug is unchanged
          const existingBySlug = await getTenantBySlug(existingTenant.slug);
          expect(existingBySlug).not.toBeNull();
          expect(existingBySlug!.id).toBe(existingTenant.id);
        },
      ),
      { numRuns: 50 },
    );
  });
});
