/**
 * Notification Daemon — BullMQ worker for scheduled alert evaluation and email dispatch
 * Feature: universal-data-calibration-platform
 */
import { pool } from '../db/pool';
import { evaluateAlertRule, AlertRule } from './alert.service';
import { writeAuditEntry } from '../audit/audit.service';
import { logger } from '../middleware/logging.middleware';

// Email sender interface — injected for testability
export interface EmailSender {
  send(to: string[], subject: string, body: string): Promise<void>;
}

// Default nodemailer-based sender (wired at startup)
let emailSender: EmailSender = {
  async send(to, subject, body) {
    // Nodemailer integration — configured via env vars SMTP_HOST, SMTP_PORT, etc.
    logger.info({ msg: 'Email sent (stub)', to, subject, bodyLength: body.length });
  },
};

export function setEmailSender(sender: EmailSender): void {
  emailSender = sender;
}

// Retry with exponential backoff: 1s, 2s, 4s
async function sendWithRetry(
  to: string[],
  subject: string,
  body: string,
  maxRetries = 3,
): Promise<void> {
  let attempt = 0;
  let delay = 1000;
  while (attempt < maxRetries) {
    try {
      await emailSender.send(to, subject, body);
      return;
    } catch (err) {
      attempt++;
      if (attempt >= maxRetries) throw err;
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
}

// Evaluate all active alert rules for all tenants and dispatch notifications
export async function runNotificationDaemon(): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed = 0;

  // Fetch all active alert rules across all tenants
  const rulesResult = await pool.query(
    `SELECT ar.*, t.id as tenant_id
     FROM alert_rules ar
     JOIN tenants t ON t.id = ar.tenant_id
     WHERE ar.is_active = true AND t.deleted_at IS NULL`,
  );

  for (const rule of rulesResult.rows as AlertRule[]) {
    try {
      const { triggeredRecordIds } = await evaluateAlertRule(rule.tenant_id, rule.id);

      if (triggeredRecordIds.length === 0) continue;

      const subject = `Alert: ${rule.name} triggered for ${triggeredRecordIds.length} record(s)`;
      const body = `Alert rule "${rule.name}" was triggered.\n\nAffected record IDs:\n${triggeredRecordIds.join('\n')}`;

      // Log to notification_log
      const notifResult = await pool.query(
        `INSERT INTO notification_log (tenant_id, alert_rule_id, status, attempt_count)
         VALUES ($1, $2, 'pending', 0) RETURNING id`,
        [rule.tenant_id, rule.id],
      );
      const notifId = notifResult.rows[0].id as string;

      try {
        await sendWithRetry(rule.recipients, subject, body);

        await pool.query(
          `UPDATE notification_log SET status = 'sent', attempt_count = attempt_count + 1,
           last_attempt = now() WHERE id = $1`,
          [notifId],
        );

        // Write audit log entry for each triggered record
        for (const recordId of triggeredRecordIds) {
          await writeAuditEntry({
            tenant_id: rule.tenant_id,
            actor_user_id: '00000000-0000-0000-0000-000000000000',
            record_id: recordId,
            entity_type: 'notification',
            action: 'alert_triggered',
            field_name: null,
            old_value: null,
            new_value: null,
            metadata: { rule_name: rule.name, rule_id: rule.id },
          });
        }

        processed++;
      } catch (emailErr) {
        await pool.query(
          `UPDATE notification_log SET status = 'failed', attempt_count = 3,
           last_attempt = now(), error_message = $1 WHERE id = $2`,
          [String(emailErr), notifId],
        );
        logger.error({ msg: 'Email delivery failed after retries', ruleId: rule.id, err: emailErr });
        failed++;
      }
    } catch (err) {
      logger.error({ msg: 'Alert rule evaluation failed', ruleId: rule.id, err });
      failed++;
    }
  }

  return { processed, failed };
}
