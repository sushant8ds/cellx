/**
 * PreprocessingScanner — pure analysis pass on parsed file rows
 * Feature: universal-data-calibration-platform, Requirement 15
 *
 * No database writes. Returns a PreprocessingReport describing all detected
 * issues and the cleaning actions that will be applied on confirm.
 */

export interface PreprocessingReport {
  totalRows: number;
  issuesByCategory: {
    missingValues: number;
    typeMismatches: number;
    duplicates: number;
    inconsistentFormats: number;
  };
  cleaningActions: Array<{
    rowIndex: number;
    column: string;
    originalValue: string;
    correctedValue: string;
    action: 'date_normalized' | 'number_normalized' | 'whitespace_trimmed' | 'duplicate_removed';
  }>;
  flaggedRows: Array<{
    rowIndex: number;
    column: string;
    issue: string;
    requiresUserAction: boolean;
  }>;
}

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

const DATE_PATTERNS = [
  // ISO 8601
  { re: /^\d{4}-\d{2}-\d{2}$/, label: 'YYYY-MM-DD' },
  // DD/MM/YYYY
  { re: /^\d{2}\/\d{2}\/\d{4}$/, label: 'DD/MM/YYYY' },
  // MM-DD-YYYY
  { re: /^\d{2}-\d{2}-\d{4}$/, label: 'MM-DD-YYYY' },
  // MM/DD/YYYY
  { re: /^\d{2}\/\d{2}\/\d{4}$/, label: 'MM/DD/YYYY' },
  // D Month YYYY
  { re: /^\d{1,2}\s+\w+\s+\d{4}$/, label: 'D Month YYYY' },
];

function detectDatePattern(value: string): string | null {
  for (const p of DATE_PATTERNS) {
    if (p.re.test(value.trim())) return p.label;
  }
  // Try generic Date.parse as fallback
  if (!isNaN(Date.parse(value.trim()))) return 'generic';
  return null;
}

function normalizeDate(value: string): string | null {
  const v = value.trim();
  // DD/MM/YYYY → YYYY-MM-DD
  const ddmmyyyy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
  if (ddmmyyyy) return `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`;
  // MM-DD-YYYY → YYYY-MM-DD
  const mmddyyyy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(v);
  if (mmddyyyy) return `${mmddyyyy[3]}-${mmddyyyy[1]}-${mmddyyyy[2]}`;
  // Try generic parse
  const d = new Date(v);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  return null;
}

function normalizeNumber(value: string): string | null {
  const v = value.trim();
  // Remove thousands separators (commas used as thousands: 1,234.56 → 1234.56)
  // Also handle European format: 1.234,56 → 1234.56
  const europeanFormat = /^\d{1,3}(\.\d{3})*(,\d+)?$/.test(v);
  if (europeanFormat) {
    return v.replace(/\./g, '').replace(',', '.');
  }
  // Standard format: remove commas as thousands separators
  const cleaned = v.replace(/,/g, '');
  if (!isNaN(Number(cleaned))) return cleaned;
  return null;
}

function isMissing(value: string): boolean {
  return value === null || value === undefined || value.trim() === '';
}

function rowKey(row: Record<string, string>): string {
  return JSON.stringify(Object.values(row));
}

// ---------------------------------------------------------------------------
// Main scanner
// ---------------------------------------------------------------------------

export function scanFile(
  rows: Record<string, string>[],
  headers: string[],
): PreprocessingReport {
  const report: PreprocessingReport = {
    totalRows: rows.length,
    issuesByCategory: { missingValues: 0, typeMismatches: 0, duplicates: 0, inconsistentFormats: 0 },
    cleaningActions: [],
    flaggedRows: [],
  };

  // Track duplicate detection
  const seenKeys = new Set<string>();
  const duplicateRowIndices = new Set<number>();

  // Track date patterns per column for inconsistency detection
  const columnDatePatterns = new Map<string, Set<string>>();

  // First pass: detect duplicates and collect date patterns
  for (let i = 0; i < rows.length; i++) {
    const key = rowKey(rows[i]);
    if (seenKeys.has(key)) {
      duplicateRowIndices.add(i);
    } else {
      seenKeys.add(key);
    }

    for (const col of headers) {
      const val = rows[i][col] ?? '';
      if (!isMissing(val)) {
        const pattern = detectDatePattern(val);
        if (pattern) {
          if (!columnDatePatterns.has(col)) columnDatePatterns.set(col, new Set());
          columnDatePatterns.get(col)!.add(pattern);
        }
      }
    }
  }

  // Detect inconsistent date formats (multiple patterns in same column)
  const inconsistentDateCols = new Set<string>();
  for (const [col, patterns] of columnDatePatterns.entries()) {
    if (patterns.size > 1) {
      inconsistentDateCols.add(col);
      report.issuesByCategory.inconsistentFormats++;
    }
  }

  // Second pass: build cleaning actions and flagged rows
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // Duplicate rows
    if (duplicateRowIndices.has(i)) {
      report.issuesByCategory.duplicates++;
      report.cleaningActions.push({
        rowIndex: i + 2, // +2 for 1-indexed + header row
        column: '(all)',
        originalValue: JSON.stringify(row),
        correctedValue: '(removed)',
        action: 'duplicate_removed',
      });
      continue; // skip further analysis for duplicate rows
    }

    for (const col of headers) {
      const raw = row[col] ?? '';

      // Missing values
      if (isMissing(raw)) {
        report.issuesByCategory.missingValues++;
        report.flaggedRows.push({
          rowIndex: i + 2,
          column: col,
          issue: 'Missing value',
          requiresUserAction: true,
        });
        continue;
      }

      // Whitespace trimming
      if (raw !== raw.trim()) {
        report.cleaningActions.push({
          rowIndex: i + 2,
          column: col,
          originalValue: raw,
          correctedValue: raw.trim(),
          action: 'whitespace_trimmed',
        });
      }

      const trimmed = raw.trim();

      // Date normalization (for columns with date patterns)
      if (columnDatePatterns.has(col)) {
        const normalized = normalizeDate(trimmed);
        if (normalized && normalized !== trimmed) {
          report.cleaningActions.push({
            rowIndex: i + 2,
            column: col,
            originalValue: trimmed,
            correctedValue: normalized,
            action: 'date_normalized',
          });
        } else if (!normalized) {
          report.issuesByCategory.typeMismatches++;
          report.flaggedRows.push({
            rowIndex: i + 2,
            column: col,
            issue: `Cannot parse "${trimmed}" as a date`,
            requiresUserAction: false,
          });
        }
        continue;
      }

      // Number normalization (detect European format or comma-separated thousands)
      const hasComma = trimmed.includes(',');
      const hasDot = trimmed.includes('.');
      if (hasComma || hasDot) {
        const normalized = normalizeNumber(trimmed);
        if (normalized !== null && normalized !== trimmed) {
          report.cleaningActions.push({
            rowIndex: i + 2,
            column: col,
            originalValue: trimmed,
            correctedValue: normalized,
            action: 'number_normalized',
          });
        }
      }
    }
  }

  return report;
}

// ---------------------------------------------------------------------------
// Apply cleaning to rows (used on confirm)
// ---------------------------------------------------------------------------

export interface CleaningOptions {
  overrides?: Record<string, Record<string, string>>; // { rowIndex: { column: newValue } }
  fillValues?: Record<string, string>;                // { column: defaultValue } for missing cells
  skipRows?: number[];                                // row indices (1-indexed) to skip
}

export function applyCleaningToRows(
  rows: Record<string, string>[],
  headers: string[],
  report: PreprocessingReport,
  options: CleaningOptions = {},
): { cleanedRows: Record<string, string>[]; summary: { corrected: number; duplicatesRemoved: number; flagged: number } } {
  const { overrides = {}, fillValues = {}, skipRows = [] } = options;
  const skipSet = new Set(skipRows);

  // Build a map of cleaning actions by rowIndex+column for fast lookup
  const actionMap = new Map<string, string>();
  for (const action of report.cleaningActions) {
    if (action.action !== 'duplicate_removed') {
      actionMap.set(`${action.rowIndex}:${action.column}`, action.correctedValue);
    }
  }

  // Identify duplicate row indices (1-indexed)
  const duplicateRowIndices = new Set(
    report.cleaningActions
      .filter(a => a.action === 'duplicate_removed')
      .map(a => a.rowIndex),
  );

  const cleanedRows: Record<string, string>[] = [];
  let corrected = 0;
  let duplicatesRemoved = 0;

  for (let i = 0; i < rows.length; i++) {
    const rowIndex = i + 2; // 1-indexed + header

    // Skip explicitly skipped rows
    if (skipSet.has(rowIndex)) continue;

    // Remove duplicates
    if (duplicateRowIndices.has(rowIndex)) {
      duplicatesRemoved++;
      continue;
    }

    const cleanedRow: Record<string, string> = {};

    for (const col of headers) {
      const raw = rows[i][col] ?? '';
      const overrideKey = `${rowIndex}`;
      const override = overrides[overrideKey]?.[col];

      if (override !== undefined) {
        cleanedRow[col] = override;
        corrected++;
        continue;
      }

      if (isMissing(raw) && fillValues[col] !== undefined) {
        cleanedRow[col] = fillValues[col];
        corrected++;
        continue;
      }

      const actionKey = `${rowIndex}:${col}`;
      if (actionMap.has(actionKey)) {
        cleanedRow[col] = actionMap.get(actionKey)!;
        corrected++;
      } else {
        cleanedRow[col] = raw;
      }
    }

    cleanedRows.push(cleanedRow);
  }

  return {
    cleanedRows,
    summary: {
      corrected,
      duplicatesRemoved,
      flagged: report.flaggedRows.filter(r => !skipSet.has(r.rowIndex)).length,
    },
  };
}
