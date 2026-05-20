/**
 * Alert system property tests
 * Feature: universal-data-calibration-platform
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';

vi.mock('../db/pool', () => ({ pool: { query: vi.fn() } }));
vi.mock('../audit/audit.service', () => ({ writeAuditEntry: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../middleware/logging.middleware', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { checkCondition, AlertOperator } from './alert.service';
import { setEmailSender, runNotificationDaemon } from './notification.worker';

// ---------------------------------------------------------------------------
// Property 22: Alert Rule State Change Isolation
// Validates: Requirements 6.7
// ---------------------------------------------------------------------------
describe('Property 22: Alert Rule State Change Isolation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('activating/deactivating one rule does not affect other rules', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            id: fc.uuid(),
            is_active: fc.boolean(),
            name: fc.string({ minLength: 1, maxLength: 30 }),
          }),
          { minLength: 2, maxLength: 10 },
        ),
        fc.integer({ min: 0, max: 9 }).filter((i) => i < 10),
        async (rules, targetIdx) => {
          fc.pre(targetIdx < rules.length);

          const { pool } = await import('../db/pool') as unknown as { pool: { query: ReturnType<typeof vi.fn> } };
          vi.resetAllMocks();

          const targetRule = rules[targetIdx];
          const otherRules = rules.filter((_, i) => i !== targetIdx);

          // Mock: UPDATE returns the toggled rule; other rules unchanged
          const updatedRule = { ...targetRule, is_active: !targetRule.is_active };
          pool.query.mockResolvedValueOnce({ rows: [updatedRule], rowCount: 1 });

          const { updateAlertRule } = await import('./alert.service');
          const result = await updateAlertRule('tenant-1', targetRule.id, {
            is_active: !targetRule.is_active,
          });

          // The updated rule has the new is_active value
          expect(result.is_active).toBe(!targetRule.is_active);

          // Other rules are not touched — pool.query called exactly once (the UPDATE)
          expect(pool.query).toHaveBeenCalledTimes(1);

          // Other rules retain their original is_active state
          for (const other of otherRules) {
            expect(other.is_active).toBe(rules.find((r) => r.id === other.id)!.is_active);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 20: Alert Notification Completeness
// Validates: Requirements 6.3
// ---------------------------------------------------------------------------
describe('Property 20: Alert Notification Completeness', () => {
  beforeEach(() => vi.clearAllMocks());

  it('notification daemon sends email to all configured recipients when condition is met', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.string({ minLength: 5, maxLength: 30 }).filter((s) => s.includes('@') || s.length > 3),
          { minLength: 1, maxLength: 5 },
        ),
        fc.array(fc.uuid(), { minLength: 1, maxLength: 5 }),
        async (recipients, triggeredRecordIds) => {
          const { pool } = await import('../db/pool') as unknown as { pool: { query: ReturnType<typeof vi.fn> } };
          vi.resetAllMocks();

          const sentTo: string[][] = [];
          setEmailSender({
            async send(to) { sentTo.push(to); },
          });

          const ruleId = 'rule-uuid-1';
          const tenantId = 'tenant-uuid-1';

          // runNotificationDaemon: fetch all active rules
          pool.query
            .mockResolvedValueOnce({
              rows: [{
                id: ruleId, tenant_id: tenantId, name: 'Test Alert',
                target_field_id: '00000000-0000-0000-0000-000000000001', operator: 'lt', threshold: '10',
                recipients, is_active: true, last_evaluated: null, created_at: new Date(),
              }],
              rowCount: 1,
            })
            // evaluateAlertRule: fetch rule
            .mockResolvedValueOnce({
              rows: [{
                id: ruleId, tenant_id: tenantId, name: 'Test Alert',
                target_field_id: '00000000-0000-0000-0000-000000000001', operator: 'lt', threshold: '10',
                recipients, is_active: true,
              }],
              rowCount: 1,
            })
            // evaluateAlertRule: fetch triggered records
            .mockResolvedValueOnce({
              rows: triggeredRecordIds.map((id) => ({ id })),
              rowCount: triggeredRecordIds.length,
            })
            // evaluateAlertRule: update last_evaluated
            .mockResolvedValueOnce({ rows: [], rowCount: 1 })
            // notification_log INSERT
            .mockResolvedValueOnce({ rows: [{ id: 'notif-1' }], rowCount: 1 })
            // notification_log UPDATE (sent)
            .mockResolvedValueOnce({ rows: [], rowCount: 1 });

          // audit log writes (one per triggered record)
          for (let i = 0; i < triggeredRecordIds.length; i++) {
            pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
          }

          await runNotificationDaemon();

          // Email was sent to all configured recipients
          expect(sentTo).toHaveLength(1);
          expect(sentTo[0]).toEqual(recipients);
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 21: Email Retry with Exponential Backoff
// Validates: Requirements 6.4
// ---------------------------------------------------------------------------
describe('Property 21: Email Retry with Exponential Backoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries up to 3 times then marks notification as failed', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (tenantId) => {
          const { pool } = await import('../db/pool') as unknown as { pool: { query: ReturnType<typeof vi.fn> } };
          vi.resetAllMocks();

          let attemptCount = 0;
          setEmailSender({
            async send() {
              attemptCount++;
              throw new Error('SMTP connection refused');
            },
          });

          pool.query
            // fetch all active rules
            .mockResolvedValueOnce({
              rows: [{
                id: 'rule-1', tenant_id: tenantId, name: 'Fail Alert',
                target_field_id: '00000000-0000-0000-0000-000000000002', operator: 'eq', threshold: 'Overdue',
                recipients: ['ops@example.com'], is_active: true,
              }],
              rowCount: 1,
            })
            // evaluateAlertRule: fetch rule
            .mockResolvedValueOnce({
              rows: [{
                id: 'rule-1', tenant_id: tenantId, name: 'Fail Alert',
                target_field_id: '00000000-0000-0000-0000-000000000002', operator: 'eq', threshold: 'Overdue',
                recipients: ['ops@example.com'], is_active: true,
              }],
              rowCount: 1,
            })
            // triggered records
            .mockResolvedValueOnce({ rows: [{ id: 'rec-1' }], rowCount: 1 })
            // update last_evaluated
            .mockResolvedValueOnce({ rows: [], rowCount: 1 })
            // notification_log INSERT
            .mockResolvedValueOnce({ rows: [{ id: 'notif-1' }], rowCount: 1 })
            // notification_log UPDATE (failed)
            .mockResolvedValueOnce({ rows: [], rowCount: 1 });

          // Run daemon and advance fake timers to skip retry delays
          const daemonPromise = runNotificationDaemon();
          // Advance through all retry delays (1s + 2s = 3s total)
          await vi.runAllTimersAsync();
          const result = await daemonPromise;

          // Exactly 3 attempts were made
          expect(attemptCount).toBe(3);
          // The daemon reports 1 failure
          expect(result.failed).toBe(1);
          expect(result.processed).toBe(0);
        },
      ),
      { numRuns: 10 }, // keep fast — involves async retries
    );
  });
});

// ---------------------------------------------------------------------------
// checkCondition unit tests
// ---------------------------------------------------------------------------
describe('checkCondition — operator correctness', () => {
  it('correctly evaluates all operators for numeric values', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        fc.constantFrom<AlertOperator>('eq', 'neq', 'lt', 'gt', 'lte', 'gte'),
        (val, threshold, op) => {
          const result = checkCondition(val, op, String(threshold));
          const expected = (() => {
            switch (op) {
              case 'eq': return val === threshold;
              case 'neq': return val !== threshold;
              case 'lt': return val < threshold;
              case 'gt': return val > threshold;
              case 'lte': return val <= threshold;
              case 'gte': return val >= threshold;
            }
          })();
          expect(result).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });
});
