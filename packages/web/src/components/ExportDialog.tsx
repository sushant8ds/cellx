import React, { useState } from 'react';
import api from '../lib/api';

interface Props {
  tenantId: string;
  filters?: Record<string, string>;
  sortBy?: string;
  onClose: () => void;
}

type Format = 'xlsx' | 'pdf';
type Status = 'idle' | 'loading' | 'done' | 'error';

export default function ExportDialog({ tenantId, filters = {}, sortBy, onClose }: Props) {
  const [format, setFormat] = useState<Format>('xlsx');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  async function handleExport() {
    setStatus('loading');
    setErrorMsg('');
    try {
      const response = await api.post(
        `/tenants/${tenantId}/exports`,
        { filters, sortBy, format },
        { responseType: 'blob' },
      );

      const jobId = response.headers['x-job-id'] as string | undefined;
      const blob = new Blob([response.data as BlobPart]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `export-${Date.now()}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setStatus('done');
      // Auto-close after 1.5s on success
      setTimeout(onClose, 1500);
    } catch {
      setStatus('error');
      setErrorMsg('Export failed. Please try again.');
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
    }}>
      <div style={{
        background: '#fff', borderRadius: 8, padding: 24, minWidth: 340,
        boxShadow: '0 4px 24px rgba(0,0,0,0.15)',
      }}>
        <h2 style={{ margin: '0 0 16px', fontSize: 16 }}>Export Report</h2>

        {status === 'done' ? (
          <div style={{ color: '#16a34a', padding: '8px 0' }}>
            ✅ Export downloaded successfully.
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, marginBottom: 6, fontWeight: 500 }}>Format</label>
              <div style={{ display: 'flex', gap: 12 }}>
                {(['xlsx', 'pdf'] as Format[]).map(f => (
                  <label key={f} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 14 }}>
                    <input
                      type="radio"
                      name="format"
                      value={f}
                      checked={format === f}
                      onChange={() => setFormat(f)}
                    />
                    {f === 'xlsx' ? '📊 Excel (.xlsx)' : '📄 PDF (.pdf)'}
                  </label>
                ))}
              </div>
            </div>

            {Object.keys(filters).length > 0 && (
              <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 12px', marginBottom: 16, fontSize: 12, color: '#6b7280' }}>
                <strong>Active filters:</strong> {Object.entries(filters).map(([k, v]) => `${k}=${v}`).join(', ')}
              </div>
            )}

            {status === 'error' && (
              <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{errorMsg}</div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={onClose}
                style={{ padding: '6px 16px', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', background: '#fff', fontSize: 13 }}
              >
                Cancel
              </button>
              <button
                onClick={handleExport}
                disabled={status === 'loading'}
                style={{
                  padding: '6px 16px',
                  background: status === 'loading' ? '#93c5fd' : '#2563eb',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  cursor: status === 'loading' ? 'not-allowed' : 'pointer',
                  fontSize: 13,
                }}
              >
                {status === 'loading' ? 'Exporting…' : 'Download'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
