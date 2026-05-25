/**
 * ImportService — file parsing, type inference, and record insertion
 * Feature: universal-data-calibration-platform
 */
import { Workbook } from 'exceljs';
import { parse as csvParse } from 'csv-parse/sync';
import { pool } from '../db/pool';
import { DynamicField, FieldType, validateFieldValue } from '../schema/schema.service';

export class ImportError extends Error {
  constructor(msg: string) { super(msg); this.name = 'ImportError'; }
}

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

export interface ParsedFile {
  headers: string[];
  rows: Record<string, string>[];
}

export interface ImportSummary {
  imported: number;
  skipped: number;
  errors: Array<{ row: number; reason: string }>;
}

// ---------------------------------------------------------------------------
// parseFile
// ---------------------------------------------------------------------------
export async function parseFile(buffer: Buffer, filename: string): Promise<ParsedFile> {
  if (buffer.length > MAX_FILE_SIZE) {
    throw new ImportError('File too large. Maximum size is 50 MB.');
  }

  const ext = filename.toLowerCase().split('.').pop();

  if (ext === 'csv') {
    try {
      const records = csvParse(buffer, { columns: true, skip_empty_lines: true, cast: false }) as Record<string, string>[];
      const headers = records.length > 0 ? Object.keys(records[0]) : [];
      return { headers, rows: records };
    } catch (err) {
      throw new ImportError(`CSV parse error: ${String(err)}`);
    }
  }

  if (ext === 'xlsx') {
    try {
      const workbook = new Workbook();
      await workbook.xlsx.load(buffer.buffer as ArrayBuffer);
      const worksheet = workbook.worksheets[0];
      if (!worksheet) throw new ImportError('No worksheets found in file.');

      const headers: string[] = [];
      const rows: Record<string, string>[] = [];

      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) {
          row.eachCell((cell) => headers.push(String(cell.value ?? '')));
        } else {
          const record: Record<string, string> = {};
          row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
            const header = headers[colNumber - 1];
            if (header) record[header] = String(cell.value ?? '');
          });
          rows.push(record);
        }
      });

      return { headers, rows };
    } catch (err) {
      if (err instanceof ImportError) throw err;
      throw new ImportError(`XLSX parse error: ${String(err)}`);
    }
  }

  throw new ImportError(`Unsupported file format: .${ext}. Only .xlsx and .csv are accepted.`);
}

// ---------------------------------------------------------------------------
// inferDataType
// ---------------------------------------------------------------------------
export function inferDataType(values: string[]): FieldType {
  const sample = values.filter((v) => v.trim() !== '').slice(0, 100);
  if (sample.length === 0) return 'text';

  const isInteger = sample.every((v) => /^-?\d+$/.test(v.trim()));
  if (isInteger) return 'integer';

  const isFloat = sample.every((v) => /^-?\d+(\.\d+)?$/.test(v.trim()));
  if (isFloat) return 'float';

  const isDate = sample.every((v) => !isNaN(Date.parse(v.trim())));
  if (isDate) return 'date';

  return 'text';
}

// ---------------------------------------------------------------------------
// processImport
// ---------------------------------------------------------------------------
export async function processImport(
  tenantId: string,
  rows: Record<string, string>[],
  mapping: Record<string, string>, // sourceColumn -> fieldId
  schema: DynamicField[],
  collectionId?: string, // optional — required when collection_id is NOT NULL
): Promise<ImportSummary> {
  const schemaMap = new Map(schema.map((f) => [f.id, f]));
  const errors: Array<{ row: number; reason: string }> = [];
  const validRows: Record<string, unknown>[] = [];

  for (let i = 0; i < rows.length; i++) {
    const sourceRow = rows[i];
    const data: Record<string, unknown> = {};
    let rowValid = true;

    for (const [sourceCol, fieldId] of Object.entries(mapping)) {
      const rawValue = sourceRow[sourceCol];
      const field = schemaMap.get(fieldId);
      if (!field) continue;

      // Coerce value to field type
      let coerced: unknown = rawValue;
      if (field.field_type === 'integer') {
        const n = parseInt(rawValue, 10);
        if (isNaN(n)) { errors.push({ row: i + 2, reason: `Column "${sourceCol}": cannot coerce "${rawValue}" to integer` }); rowValid = false; break; }
        coerced = n;
      } else if (field.field_type === 'float') {
        const n = parseFloat(rawValue);
        if (isNaN(n)) { errors.push({ row: i + 2, reason: `Column "${sourceCol}": cannot coerce "${rawValue}" to float` }); rowValid = false; break; }
        coerced = n;
      } else if (field.field_type === 'date') {
        const d = new Date(rawValue);
        if (isNaN(d.getTime())) { errors.push({ row: i + 2, reason: `Column "${sourceCol}": cannot coerce "${rawValue}" to date` }); rowValid = false; break; }
        coerced = d.toISOString().split('T')[0];
      }

      // Validate constraints
      const validation = validateFieldValue(field, coerced);
      if (!validation.valid) { errors.push({ row: i + 2, reason: `Column "${sourceCol}": ${validation.error}` }); rowValid = false; break; }

      data[fieldId] = coerced;
    }

    if (rowValid) validRows.push(data);
  }

  // Bulk INSERT using unnest() — single round-trip regardless of row count.
  let imported = 0;
  if (validRows.length > 0) {
    const tenantIds = validRows.map(() => tenantId);
    const dataValues = validRows.map((d) => JSON.stringify(d));

    if (collectionId) {
      // Include collection_id when provided (required after 002_collections migration)
      const collectionIds = validRows.map(() => collectionId);
      await pool.query(
        `INSERT INTO records (tenant_id, data, collection_id)
         SELECT * FROM unnest($1::uuid[], $2::jsonb[], $3::uuid[])`,
        [tenantIds, dataValues, collectionIds],
      );
    } else {
      await pool.query(
        `INSERT INTO records (tenant_id, data)
         SELECT * FROM unnest($1::uuid[], $2::jsonb[])`,
        [tenantIds, dataValues],
      );
    }
    imported = validRows.length;
  }

  return { imported, skipped: errors.length, errors };
}

// ---------------------------------------------------------------------------
// importFromGoogleSheet
// Downloads a publicly shared Google Spreadsheet as CSV and pipes it through
// the existing parseFile → processImport pipeline.
//
// Requirements:
//   - The sheet must be shared as "Anyone with the link can view"
//   - Uses the Google Visualization API CSV export endpoint (no auth required)
//   - For private sheets, swap the endpoint for an authenticated googleapis
//     JWT client using a Google Service Account key
// ---------------------------------------------------------------------------

/**
 * Extracts the spreadsheet ID from a Google Sheets sharing URL.
 * Handles all common URL formats:
 *   https://docs.google.com/spreadsheets/d/{ID}/edit
 *   https://docs.google.com/spreadsheets/d/{ID}/pub
 *   https://docs.google.com/spreadsheets/d/{ID}
 */
export function extractSpreadsheetId(url: string): string | null {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

export interface GoogleSheetImportResult {
  headers: string[];
  rowCount: number;
  imported: number;
  skipped: number;
  errors: Array<{ row: number; reason: string }>;
}

export async function importFromGoogleSheet(
  tenantId: string,
  sheetUrl: string,
  collectionId: string,
  mapping: Record<string, string>,
  schema: DynamicField[],
): Promise<GoogleSheetImportResult> {
  const spreadsheetId = extractSpreadsheetId(sheetUrl);
  if (!spreadsheetId) {
    throw new ImportError('Invalid Google Spreadsheet URL. Make sure it contains /spreadsheets/d/{ID}.');
  }

  // Google Visualization API: exports the first sheet as CSV without authentication.
  // The sheet must be shared with "Anyone with the link can view".
  const csvEndpoint =
    `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv`;

  let csvText: string;
  try {
    // Use the built-in fetch (Node 18+) to avoid adding an axios dependency
    const response = await fetch(csvEndpoint, {
      headers: { 'User-Agent': 'CellX-Import/1.0' },
      signal: AbortSignal.timeout(30_000), // 30 s timeout
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new ImportError(
          'Google Sheets returned 403. Make sure the sheet is shared with "Anyone with the link can view".',
        );
      }
      throw new ImportError(`Google Sheets request failed with status ${response.status}.`);
    }

    csvText = await response.text();
  } catch (err) {
    if (err instanceof ImportError) throw err;
    throw new ImportError(
      `Failed to fetch Google Spreadsheet. Check the URL and sharing settings. (${String(err)})`,
    );
  }

  // Enforce the same 50 MB size limit as file uploads
  const csvBuffer = Buffer.from(csvText, 'utf-8');
  if (csvBuffer.length > MAX_FILE_SIZE) {
    throw new ImportError('Google Spreadsheet is too large. Maximum size is 50 MB.');
  }

  // Reuse the existing CSV parser
  const parsed = await parseFile(csvBuffer, 'google_sheet.csv');

  // Run through the same validation + bulk unnest() INSERT pipeline
  const summary = await processImport(tenantId, parsed.rows, mapping, schema, collectionId);

  return {
    headers: parsed.headers,
    rowCount: parsed.rows.length,
    ...summary,
  };
}
