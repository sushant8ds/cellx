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

  // Bulk INSERT in batches of 500
  let imported = 0;
  const BATCH = 500;
  for (let b = 0; b < validRows.length; b += BATCH) {
    const batch = validRows.slice(b, b + BATCH);
    for (const data of batch) {
      await pool.query(
        `INSERT INTO records (tenant_id, data) VALUES ($1, $2)`,
        [tenantId, JSON.stringify(data)],
      );
      imported++;
    }
  }

  return { imported, skipped: errors.length, errors };
}
