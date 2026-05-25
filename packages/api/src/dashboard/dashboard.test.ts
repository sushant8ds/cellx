/**
 * Dashboard property tests
 * Feature: universal-data-calibration-platform
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

vi.mock('../db/pool', () => ({ pool: { query: vi.fn() } }));

import { getDashboardCounts } from './dashboard.service';
import { broadcastToTenant, registerClient, unregisterClient, getClientCount } from './sse.service';
import type { Response } from 'express';

// ---------------------------------------------------------------------------
// Property 31: Dashboard Count Accuracy
// Validates: Requirements 9.1
// ---------------------------------------------------------------------------
describe('Property 31: Dashboard Count Accuracy', () => {
  beforeEach(() => vi.clearAllMocks());

  it('widget counts equal exact count of active records in each status category', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          safe: fc.integer({ min: 0, max: 20 }),
          warning: fc.integer({ min: 0, max: 20 }),
          danger: fc.integer({ min: 0, max: 20 }),
          overdue: fc.integer({ min: 0, max: 20 }),
        }),
        fc.uuid(),
        async ({ safe, warning, danger, overdue }, tenantId) => {
          const { pool } = await import('../db/pool') as unknown as { pool: { query: ReturnType<typeof vi.fn> } };
          vi.clearAllMocks();

          const total = safe + warning + danger + overdue;

          // First query: GROUP BY aggregation — returns one row per distinct status value
          const groupByRows: { status_val: string; cnt: string }[] = [
            ...Array(safe > 0 ? 1 : 0).fill(null).map(() => ({ status_val: 'Safe', cnt: String(safe) })),
            ...Array(warning > 0 ? 1 : 0).fill(null).map(() => ({ status_val: 'Warning', cnt: String(warning) })),
            ...Array(danger > 0 ? 1 : 0).fill(null).map(() => ({ status_val: 'Danger', cnt: String(danger) })),
            ...Array(overdue > 0 ? 1 : 0).fill(null).map(() => ({ status_val: 'Overdue', cnt: String(overdue) })),
          ];
          pool.query
            .mockResolvedValueOnce({ rows: groupByRows, rowCount: groupByRows.length })
            // Second query: total COUNT(*)
            .mockResolvedValueOnce({ rows: [{ cnt: String(total) }], rowCount: 1 });

          const counts = await getDashboardCounts(tenantId);

          // Exact counts — no over-counting or under-counting
          expect(counts.safe).toBe(safe);
          expect(counts.warning).toBe(warning);
          expect(counts.danger).toBe(danger);
          expect(counts.overdue).toBe(overdue);
          expect(counts.total).toBe(total);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('records with no status field are counted in total but not in any category', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 20 }),
        fc.uuid(),
        async (n, tenantId) => {
          const { pool } = await import('../db/pool') as unknown as { pool: { query: ReturnType<typeof vi.fn> } };
          vi.clearAllMocks();

          // GROUP BY returns no rows (no status values matched)
          pool.query
            .mockResolvedValueOnce({ rows: [], rowCount: 0 })
            // Total COUNT(*) returns n
            .mockResolvedValueOnce({ rows: [{ cnt: String(n) }], rowCount: 1 });

          const counts = await getDashboardCounts(tenantId);

          expect(counts.total).toBe(n);
          expect(counts.safe + counts.warning + counts.danger + counts.overdue).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// SSE Service unit tests
// ---------------------------------------------------------------------------
describe('SSEService — client management', () => {
  it('registers and unregisters clients correctly', () => {
    const tenantId = 'tenant-sse-test';
    const mockRes = { write: vi.fn() } as unknown as Response;

    expect(getClientCount(tenantId)).toBe(0);

    registerClient(tenantId, mockRes);
    expect(getClientCount(tenantId)).toBe(1);

    unregisterClient(tenantId, mockRes);
    expect(getClientCount(tenantId)).toBe(0);
  });

  it('broadcastToTenant writes SSE payload to all registered clients', () => {
    const tenantId = 'tenant-broadcast-test';
    const res1 = { write: vi.fn() } as unknown as Response;
    const res2 = { write: vi.fn() } as unknown as Response;

    registerClient(tenantId, res1);
    registerClient(tenantId, res2);

    broadcastToTenant(tenantId, { type: 'dashboard_update', data: { safe: 5, warning: 2, danger: 1, overdue: 0, total: 8 } });

    expect(res1.write).toHaveBeenCalledOnce();
    expect(res2.write).toHaveBeenCalledOnce();

    const payload = (res1.write as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(payload).toContain('event: dashboard_update');
    expect(payload).toContain('"safe":5');

    // Cleanup
    unregisterClient(tenantId, res1);
    unregisterClient(tenantId, res2);
  });

  it('broadcastToTenant is a no-op when no clients are connected', () => {
    // Should not throw
    expect(() => broadcastToTenant('no-clients-tenant', { type: 'heartbeat', data: {} })).not.toThrow();
  });
});
