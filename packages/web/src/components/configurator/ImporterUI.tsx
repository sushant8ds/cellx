import React, { useState, useRef, useCallback } from 'react';
import { useSchema } from '../../hooks/useRecords';
import api from '../../lib/api';

interface Props { tenantId: string }

interface PreprocessingReport {
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
    action: string;
  }>;
  flaggedRows: Array<{
    rowIndex: number;
    column: string;
    issue: string;
    requiresUserAction: boolean;
  }>;
}

interface UploadResponse {
  jobId: string;
  headers: string[];
  inferredTypes: Record<string, string>;
  rowCount: number;
  report: PreprocessingReport;
}

interface ColumnMapping {
  header: string;
  inferredType: string;
  targetFieldId: string;
}

interface JobStatus {
  status: string;
  progress_percent: number;
  metadata?: {
    importSummary?: { imported: number; skipped: number };
    preprocessingSummary?: { corrected: number; duplicatesRemoved: number; flagged: number };
  };
}

const ACTION_LABELS: Record<string, string> = {
  date_normalized: '📅 Date normalized',
  number_normalized: '🔢 Number normalized',
  whitespace_trimmed: '✂️ Whitespace trimmed',
  duplicate_removed: '🗑️ Duplicate removed',
};

export default function ImporterUI({ tenantId }: Props) {
  const { data: fields = [] } = useSchema(tenantId);
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploadData, setUploadData] = useState<UploadResponse | null>(null);
  const [columns, setColumns] = useState<ColumnMapping[]>([]);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  function startPolling(jid: string) {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get<JobStatus>(`/tenants/${tenantId}/jobs/${jid}`);
        setJob(data);
        if (data.status === 'completed' || data.status === 'failed') stopPolling();
      } catch { /* ignore */ }
    }, 2000);
  }

  async function handleFileSelect(f: File) {
    setFile(f); setUploadData(null); setColumns([]); setJob(null); setError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const { data } = await api.post<UploadResponse>(
        `/tenants/${tenantId}/imports`, fd,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      setUploadData(data);
      setColumns(data.headers.map(h => ({ header: h, inferredType: data.inferredTypes[h] ?? 'text', targetFieldId: '' })));
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Upload failed');
    } finally { setUploading(false); }
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFileSelect(f);
  }, [tenantId]);

  async function handleConfirm() {
    if (!uploadData) return;
    setConfirming(true); setError(null);
    try {
      const mapping: Record<string, string> = {};
      for (const col of columns) {
        if (col.targetFieldId) mapping[col.header] = col.targetFieldId;
      }
      const { data } = await api.post<{ jobId: string }>(
        `/tenants/${tenantId}/imports/${uploadData.jobId}/confirm`,
        { mapping },
      );
      startPolling(data.jobId);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Import failed');
    } finally { setConfirming(false); }
  }

  function reset() { setFile(null); setUploadData(null); setColumns([]); setJob(null); setError(null); }

  const report = uploadData?.report;
  const totalIssues = report
    ? Object.values(report.issuesByCategory).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>Import Data</h2>

      {/* Dropzone */}
      {!file && (
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{ border: `2px dashed ${dragging ? '#2563eb' : '#d1d5db'}`, borderRadius: 8, padding: 40, textAlign: 'center', cursor: 'pointer', background: dragging ? '#eff6ff' : '#f9fafb', marginBottom: 24 }}
        >
          <div style={{ fontSize: 32, marginBottom: 8 }}>📂</div>
          <div style={{ color: '#374151', fontWeight: 500 }}>Drag & drop a CSV or XLSX file here</div>
          <div style={{ color: '#9ca3af', fontSize: 13, marginTop: 4 }}>or click to browse (max 50 MB)</div>
          <input ref={fileInputRef} type="file" accept=".csv,.xlsx" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }} />
        </div>
      )}

      {uploading && <div style={{ color: '#2563eb', marginBottom: 16 }}>🔍 Analyzing file for data quality issues…</div>}
      {error && <div style={{ color: '#dc2626', background: '#fee2e2', padding: 10, borderRadius: 6, marginBottom: 16 }}>{error}</div>}

      {/* Preprocessing Report */}
      {report && !job && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>
              🧠 Data Quality Report
              {totalIssues > 0
                ? <span style={{ marginLeft: 8, background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 12, fontSize: 12 }}>{totalIssues} issues detected</span>
                : <span style={{ marginLeft: 8, background: '#dcfce7', color: '#16a34a', padding: '2px 8px', borderRadius: 12, fontSize: 12 }}>✅ No issues</span>
              }
            </h3>
            <button onClick={() => setShowReport(v => !v)} style={{ fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}>
              {showReport ? 'Hide' : 'Show'} details
            </button>
          </div>

          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 12 }}>
            {[
              { label: 'Missing Values', count: report.issuesByCategory.missingValues, color: '#dc2626' },
              { label: 'Type Mismatches', count: report.issuesByCategory.typeMismatches, color: '#f59e0b' },
              { label: 'Duplicates', count: report.issuesByCategory.duplicates, color: '#8b5cf6' },
              { label: 'Format Issues', count: report.issuesByCategory.inconsistentFormats, color: '#0891b2' },
            ].map(s => (
              <div key={s.label} style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: '10px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: s.count > 0 ? s.color : '#9ca3af' }}>{s.count}</div>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {showReport && report.cleaningActions.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: '#374151' }}>
                Auto-cleaning actions ({report.cleaningActions.length}):
              </div>
              <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 6 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead style={{ position: 'sticky', top: 0, background: '#f3f4f6' }}>
                    <tr>
                      <th style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Row</th>
                      <th style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Column</th>
                      <th style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Original</th>
                      <th style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Corrected</th>
                      <th style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.cleaningActions.slice(0, 50).map((a, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={{ padding: '4px 10px', color: '#6b7280' }}>{a.rowIndex}</td>
                        <td style={{ padding: '4px 10px' }}>{a.column}</td>
                        <td style={{ padding: '4px 10px', fontFamily: 'monospace', color: '#dc2626', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.originalValue}</td>
                        <td style={{ padding: '4px 10px', fontFamily: 'monospace', color: '#16a34a', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.correctedValue}</td>
                        <td style={{ padding: '4px 10px', color: '#6b7280' }}>{ACTION_LABELS[a.action] ?? a.action}</td>
                      </tr>
                    ))}
                    {report.cleaningActions.length > 50 && (
                      <tr><td colSpan={5} style={{ padding: '6px 10px', color: '#9ca3af', textAlign: 'center' }}>…and {report.cleaningActions.length - 50} more</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {showReport && report.flaggedRows.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: '#374151' }}>
                Flagged rows requiring attention ({report.flaggedRows.length}):
              </div>
              <div style={{ maxHeight: 150, overflowY: 'auto', border: '1px solid #fca5a5', borderRadius: 6, background: '#fff5f5' }}>
                {report.flaggedRows.slice(0, 20).map((f, i) => (
                  <div key={i} style={{ padding: '6px 10px', borderBottom: '1px solid #fee2e2', fontSize: 12 }}>
                    <span style={{ color: '#6b7280' }}>Row {f.rowIndex}</span>
                    {' · '}
                    <strong>{f.column}</strong>
                    {' · '}
                    <span style={{ color: '#dc2626' }}>{f.issue}</span>
                    {f.requiresUserAction && <span style={{ marginLeft: 6, background: '#fef3c7', color: '#92400e', padding: '1px 6px', borderRadius: 10, fontSize: 11 }}>Action required</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Column mapping */}
      {columns.length > 0 && !job && (
        <>
          <h3 style={{ fontSize: 15, marginBottom: 8 }}>Column Mapping</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
            <thead>
              <tr style={{ background: '#f3f4f6' }}>
                <th style={{ textAlign: 'left', padding: '8px 12px', border: '1px solid #e5e7eb' }}>Source Column</th>
                <th style={{ textAlign: 'left', padding: '8px 12px', border: '1px solid #e5e7eb' }}>Inferred Type</th>
                <th style={{ textAlign: 'left', padding: '8px 12px', border: '1px solid #e5e7eb' }}>→ Target Field</th>
              </tr>
            </thead>
            <tbody>
              {columns.map((col, i) => (
                <tr key={col.header}>
                  <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb' }}>{col.header}</td>
                  <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb' }}>
                    <span style={{ background: '#e0e7ff', color: '#3730a3', padding: '2px 8px', borderRadius: 12, fontSize: 12 }}>{col.inferredType}</span>
                  </td>
                  <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb' }}>
                    <select value={col.targetFieldId}
                      onChange={e => setColumns(prev => prev.map((c, j) => j === i ? { ...c, targetFieldId: e.target.value } : c))}
                      style={{ padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 4, width: '100%' }}>
                      <option value="">New Field</option>
                      {fields.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleConfirm} disabled={confirming}
              style={{ padding: '8px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
              {confirming ? 'Importing…' : `Confirm Import (${uploadData?.rowCount ?? 0} rows)`}
            </button>
            <button onClick={reset} style={{ padding: '8px 16px', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', background: '#fff' }}>Cancel</button>
          </div>
        </>
      )}

      {/* Job progress */}
      {job && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontWeight: 500 }}>Import {job.status}</span>
            <span style={{ color: '#6b7280' }}>{job.progress_percent}%</span>
          </div>
          <div style={{ background: '#e5e7eb', borderRadius: 4, height: 10, overflow: 'hidden' }}>
            <div style={{ background: '#2563eb', height: '100%', width: `${job.progress_percent}%`, transition: 'width 0.3s' }} />
          </div>
          {job.status === 'completed' && job.metadata && (
            <div style={{ marginTop: 12, background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 6, padding: 12, fontSize: 13 }}>
              ✅ <strong>Import complete</strong>
              <div style={{ marginTop: 6, color: '#374151' }}>
                Imported: <strong>{job.metadata.importSummary?.imported ?? 0}</strong> rows ·
                Skipped: <strong>{job.metadata.importSummary?.skipped ?? 0}</strong> rows
                {job.metadata.preprocessingSummary && (
                  <> · Corrected: <strong>{job.metadata.preprocessingSummary.corrected}</strong> values ·
                  Duplicates removed: <strong>{job.metadata.preprocessingSummary.duplicatesRemoved}</strong></>
                )}
              </div>
            </div>
          )}
          {job.status === 'failed' && <div style={{ marginTop: 12, color: '#dc2626' }}>Import failed. Please try again.</div>}
          {(job.status === 'completed' || job.status === 'failed') && (
            <button onClick={reset} style={{ marginTop: 12, padding: '6px 16px', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', background: '#fff' }}>
              Import Another File
            </button>
          )}
        </div>
      )}
    </div>
  );
}
