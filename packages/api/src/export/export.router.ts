import { Router, Request, Response } from 'express';
import { AuthMiddleware, TenantIsolationMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { generateXlsx, generatePdf, ExportError } from './export.service';
import { listRecords } from '../records/record.service';
import { getSchema } from '../schema/schema.service';
import { getTenantById } from '../tenant/tenant.service';
import { pool } from '../db/pool';

export const exportRouter = Router();

exportRouter.use(AuthMiddleware, TenantIsolationMiddleware);

// POST /tenants/:tenantId/exports
exportRouter.post('/:tenantId/exports', requirePermission('export'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const tenantId = req.params['tenantId'] as string;
      const { filters = {}, sortBy, format = 'xlsx' } = req.body as {
        filters?: Record<string, string>;
        sortBy?: string;
        format?: 'xlsx' | 'pdf';
      };

      // Create job record
      const jobResult = await pool.query(
        `INSERT INTO background_jobs (tenant_id, type, status, progress_percent, created_by)
         VALUES ($1, 'export', 'processing', 10, $2) RETURNING id`,
        [tenantId, req.user?.userId ?? '00000000-0000-0000-0000-000000000000'],
      );
      const jobId = jobResult.rows[0].id as string;

      // Fetch data
      const [recordsResult, schema, tenant] = await Promise.all([
        listRecords(tenantId, { filters, sortBy, limit: 10000 }),
        getSchema(tenantId),
        getTenantById(tenantId),
      ]);

      const tenantName = tenant?.name ?? tenantId;
      const filterStr = Object.entries(filters).map(([k, v]) => `${k}=${v}`).join(', ');

      // Generate file
      let fileBuffer: Buffer;
      let contentType: string;
      let filename: string;

      if (format === 'pdf') {
        fileBuffer = await generatePdf(recordsResult.records, schema, tenantName, filterStr);
        contentType = 'application/pdf';
        filename = `export-${Date.now()}.pdf`;
      } else {
        fileBuffer = await generateXlsx(recordsResult.records, schema, tenantName, filterStr);
        contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        filename = `export-${Date.now()}.xlsx`;
      }

      // Update job as completed
      await pool.query(
        `UPDATE background_jobs SET status='completed', progress_percent=100,
         result_url='inline', metadata=$1 WHERE id=$2`,
        [JSON.stringify({ format, recordCount: recordsResult.records.length, filename }), jobId],
      );

      // Return file directly (for small exports; large exports would upload to S3)
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Job-Id', jobId);
      res.send(fileBuffer);
    } catch (err) {
      if (err instanceof ExportError) { res.status(422).json({ error: err.message }); return; }
      res.status(500).json({ error: 'Internal server error' });
    }
  });
