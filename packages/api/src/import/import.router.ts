import { Router, Request, Response } from 'express';
import multer from 'multer';
import { AuthMiddleware, TenantIsolationMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { parseFile, inferDataType, processImport, importFromGoogleSheet, ImportError } from './import.service';
import { scanFile, applyCleaningToRows, type CleaningOptions } from './preprocessing';
import { generateDataProfile } from '../ai/ai.service';
import { getSchema } from '../schema/schema.service';
import { pool } from '../db/pool';

export const importRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 52_428_800 } });

importRouter.use(AuthMiddleware, TenantIsolationMiddleware);

// ---------------------------------------------------------------------------
// POST /tenants/:tenantId/imports
// Upload file → run preprocessing scan → return jobId + report
// ---------------------------------------------------------------------------
importRouter.post('/:tenantId/imports', requirePermission('import'), upload.single('file'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const tenantId = req.params['tenantId'] as string;
      if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }

      const parsed = await parseFile(req.file.buffer, req.file.originalname);

      // Infer types per column
      const inferredTypes: Record<string, string> = {};
      for (const header of parsed.headers) {
        const values = parsed.rows.map((r) => r[header] ?? '');
        inferredTypes[header] = inferDataType(values);
      }

      // Run preprocessing scan (pure analysis — no DB writes yet)
      const report = scanFile(parsed.rows, parsed.headers);

      // Generate AI data profile (first 50 rows summary)
      const dataProfile = generateDataProfile(parsed.rows, parsed.headers, req.file.originalname);

      // Store parsed rows + report in background_jobs metadata
      const jobResult = await pool.query(
        `INSERT INTO background_jobs (tenant_id, type, status, progress_percent, created_by, metadata)
         VALUES ($1, 'import', 'queued', 0, $2, $3) RETURNING id`,
        [
          tenantId,
          req.user?.userId ?? '00000000-0000-0000-0000-000000000000',
          JSON.stringify({
            headers: parsed.headers,
            inferredTypes,
            rowCount: parsed.rows.length,
            // Store rows for confirm step (capped at 10k rows to avoid huge metadata)
            rows: parsed.rows.slice(0, 10_000),
            report,
            dataProfile,
          }),
        ],
      );
      const jobId = jobResult.rows[0].id as string;

      // Update job status to scan_complete
      await pool.query(
        `UPDATE background_jobs SET status='queued', progress_percent=50, metadata=$1 WHERE id=$2`,
        [JSON.stringify({ headers: parsed.headers, inferredTypes, rowCount: parsed.rows.length, rows: parsed.rows.slice(0, 10_000), report }), jobId],
      );

      res.status(202).json({
        jobId,
        headers: parsed.headers,
        inferredTypes,
        rowCount: parsed.rows.length,
        report,
        dataProfile,
      });
    } catch (err) {
      if (err instanceof ImportError) { res.status(400).json({ error: err.message }); return; }
      res.status(500).json({ error: 'Internal server error' });
    }
  });

// ---------------------------------------------------------------------------
// POST /tenants/:tenantId/imports/:jobId/confirm
// Apply cleaning + user overrides → bulk INSERT records
// ---------------------------------------------------------------------------
importRouter.post('/:tenantId/imports/:jobId/confirm', requirePermission('import'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const tenantId = req.params['tenantId'] as string;
      const jobId = req.params['jobId'] as string;
      const { mapping, overrides, fillValues, skipRows } = req.body as {
        mapping: Record<string, string>;
        overrides?: CleaningOptions['overrides'];
        fillValues?: CleaningOptions['fillValues'];
        skipRows?: number[];
      };

      if (!mapping) { res.status(400).json({ error: 'mapping is required' }); return; }

      // Load job metadata
      const jobResult = await pool.query(
        `SELECT metadata FROM background_jobs WHERE id = $1 AND tenant_id = $2`,
        [jobId, tenantId],
      );
      if (jobResult.rows.length === 0) { res.status(404).json({ error: 'Job not found' }); return; }

      const meta = jobResult.rows[0].metadata as {
        headers: string[];
        rows: Record<string, string>[];
        report: ReturnType<typeof scanFile>;
      };

      // Mark as processing
      await pool.query(
        `UPDATE background_jobs SET status='processing', progress_percent=10 WHERE id=$1`,
        [jobId],
      );

      // Apply cleaning
      const { cleanedRows, summary } = applyCleaningToRows(
        meta.rows,
        meta.headers,
        meta.report,
        { overrides, fillValues, skipRows },
      );

      // Process import with cleaned rows
      const schema = await getSchema(tenantId);
      const importSummary = await processImport(tenantId, cleanedRows, mapping, schema);

      // Store final summary in job metadata
      const finalMeta = {
        ...meta,
        preprocessingSummary: summary,
        importSummary,
      };

      await pool.query(
        `UPDATE background_jobs SET status='completed', progress_percent=100, metadata=$1 WHERE id=$2`,
        [JSON.stringify(finalMeta), jobId],
      );

      res.json({
        jobId,
        preprocessingSummary: summary,
        importSummary,
      });
    } catch (err) {
      if (err instanceof ImportError) { res.status(400).json({ error: err.message }); return; }
      res.status(500).json({ error: 'Internal server error' });
    }
  });

// ---------------------------------------------------------------------------
// GET /tenants/:tenantId/jobs/:jobId
// ---------------------------------------------------------------------------
importRouter.get('/:tenantId/jobs/:jobId', async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.params['tenantId'] as string;
    const jobId = req.params['jobId'] as string;
    const result = await pool.query(
      `SELECT id, type, status, progress_percent, result_url, metadata, created_at, updated_at
       FROM background_jobs WHERE id = $1 AND tenant_id = $2`,
      [jobId, tenantId],
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Job not found' }); return; }
    res.json(result.rows[0]);
  } catch { res.status(500).json({ error: 'Internal server error' }); }
});

// ---------------------------------------------------------------------------
// POST /tenants/:tenantId/imports/google-sheets
// Fetch a publicly shared Google Spreadsheet and import its rows.
//
// Body: {
//   url:      string  — full Google Sheets sharing URL
//   mapping:  Record<string, string>  — sourceColumn -> fieldId (optional;
//             if omitted, rows are stored with raw column names as keys)
// }
// ---------------------------------------------------------------------------
importRouter.post('/:tenantId/imports/google-sheets', requirePermission('import'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const tenantId = req.params['tenantId'] as string;
      const { url, mapping = {} } = req.body as {
        url: string;
        mapping?: Record<string, string>;
      };

      if (!url?.trim()) {
        res.status(400).json({ error: 'url is required' });
        return;
      }

      // Create a collection entry to track this Google Sheet
      const collectionResult = await pool.query(
        `INSERT INTO collections (tenant_id, name, source_type)
         VALUES ($1, $2, 'google_sheets') RETURNING id, name, source_type, created_at`,
        [tenantId, url.trim()],
      );
      const collection = collectionResult.rows[0] as {
        id: string; name: string; source_type: string; created_at: Date;
      };

      // Create a background job to track progress
      const jobResult = await pool.query(
        `INSERT INTO background_jobs (tenant_id, type, status, progress_percent, created_by)
         VALUES ($1, 'import', 'processing', 10, $2) RETURNING id`,
        [tenantId, req.user?.userId ?? '00000000-0000-0000-0000-000000000000'],
      );
      const jobId = jobResult.rows[0].id as string;

      // Fetch the schema for mapping validation
      const { getSchema } = await import('../schema/schema.service');
      const schema = await getSchema(tenantId);

      // Download + parse + bulk insert
      const result = await importFromGoogleSheet(
        tenantId,
        url.trim(),
        collection.id,
        mapping,
        schema,
      );

      await pool.query(
        `UPDATE background_jobs SET status='completed', progress_percent=100,
         metadata=$1 WHERE id=$2`,
        [JSON.stringify({ headers: result.headers, rowCount: result.rowCount, importSummary: result }), jobId],
      );

      res.status(201).json({
        jobId,
        collection,
        headers: result.headers,
        rowCount: result.rowCount,
        imported: result.imported,
        skipped: result.skipped,
        errors: result.errors,
      });
    } catch (err) {
      if (err instanceof ImportError) { res.status(400).json({ error: err.message }); return; }
      res.status(500).json({ error: String(err) });
    }
  });
