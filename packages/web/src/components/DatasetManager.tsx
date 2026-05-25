import React, { useState, useEffect } from 'react';
import api from '../lib/api';

export interface FileCollection {
  id: string;
  name: string;
  source_type: 'upload' | 'google_sheets';
  created_at: string;
}

interface Props {
  tenantId: string;
  /** Called whenever the collection list changes so parent can refresh joins */
  onCollectionsChange?: (collections: FileCollection[]) => void;
}

export function DatasetManager({ tenantId, onCollectionsChange }: Props) {
  const [collections, setCollections] = useState<FileCollection[]>([]);
  const [googleUrl, setGoogleUrl] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load existing collections on mount
  useEffect(() => {
    api.get<FileCollection[]>(`/tenants/${tenantId}/collections`)
      .then(res => {
        setCollections(res.data);
        onCollectionsChange?.(res.data);
      })
      .catch(() => {/* non-fatal — list stays empty */});
  }, [tenantId]); // eslint-disable-line react-hooks/exhaustive-deps

  function updateList(updated: FileCollection[]) {
    setCollections(updated);
    onCollectionsChange?.(updated);
  }

  // ---------------------------------------------------------------------------
  // File upload — reuses the existing import endpoint, then registers a
  // collection entry so the file appears in the dataset pool.
  // ---------------------------------------------------------------------------
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setError(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      // Upload parses the file and returns a jobId + headers
      const uploadRes = await api.post<{ jobId: string; headers: string[]; rowCount: number }>(
        `/tenants/${tenantId}/imports`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );

      // Register as a named collection
      const collectionRes = await api.post<FileCollection>(
        `/tenants/${tenantId}/collections`,
        { name: file.name, source_type: 'upload', jobId: uploadRes.data.jobId },
      );

      updateList([collectionRes.data, ...collections]);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? 'Upload failed. Check the file format and try again.');
    } finally {
      setIsUploading(false);
      // Reset input so the same file can be re-uploaded if needed
      e.target.value = '';
    }
  }

  // ---------------------------------------------------------------------------
  // Google Sheets sync
  // NOTE: The backend route /tenants/:id/imports/google-sheets is not yet
  // implemented. This sends the request and surfaces the error clearly rather
  // than silently failing. Implement the route when Google OAuth is configured.
  // ---------------------------------------------------------------------------
  async function handleGoogleSheetConnect() {
    const url = googleUrl.trim();
    if (!url) return;

    if (!url.startsWith('https://docs.google.com/spreadsheets/')) {
      setError('Please paste a valid Google Sheets URL (https://docs.google.com/spreadsheets/...)');
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      const res = await api.post<{ collection: FileCollection }>(
        `/tenants/${tenantId}/imports/google-sheets`,
        { url },
      );
      updateList([res.data.collection, ...collections]);
      setGoogleUrl('');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? 'Google Sheets sync is not yet configured on this server.');
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleRemove(id: string) {
    try {
      await api.delete(`/tenants/${tenantId}/collections/${id}`);
      updateList(collections.filter(c => c.id !== id));
    } catch {
      setError('Failed to remove dataset.');
    }
  }

  return (
    <div style={{ padding: 20, background: '#fff', borderRadius: 8, border: '1px solid #e5e7eb' }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, color: '#111827', marginBottom: 4 }}>
        Data Sources
      </h3>
      <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 16 }}>
        Connect multiple files or sheets. Use the join engine to merge them by a shared column.
      </p>

      {/* Connected datasets */}
      {collections.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
          {collections.map(c => (
            <div key={c.id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 12px', background: '#f9fafb', borderRadius: 6,
              border: '1px solid #e5e7eb', fontSize: 13,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>{c.source_type === 'google_sheets' ? '🌐' : '📄'}</span>
                <span style={{ color: '#374151', fontWeight: 500 }}>{c.name}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ color: '#10b981', fontSize: 12, fontWeight: 500 }}>Connected</span>
                <button
                  onClick={() => handleRemove(c.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 16, lineHeight: 1 }}
                  title="Remove dataset"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ padding: '16px 0', textAlign: 'center', fontSize: 13, color: '#9ca3af', marginBottom: 16 }}>
          No datasets connected yet
        </div>
      )}

      {error && (
        <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#dc2626' }}>
          {error}
        </div>
      )}

      {/* Upload a file */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={{ display: 'block', fontSize: 12, color: '#4b5563', marginBottom: 4, fontWeight: 500 }}>
            Upload a file (CSV or XLSX)
          </label>
          <label style={{
            display: 'inline-block', padding: '6px 14px',
            background: isUploading ? '#93c5fd' : '#2563eb',
            color: '#fff', borderRadius: 6,
            cursor: isUploading ? 'not-allowed' : 'pointer',
            fontSize: 13, fontWeight: 500,
          }}>
            {isUploading ? 'Uploading…' : '+ Add File'}
            <input
              type="file"
              accept=".csv,.xlsx"
              onChange={handleFileUpload}
              disabled={isUploading}
              style={{ display: 'none' }}
            />
          </label>
        </div>

        {/* Google Sheets */}
        <div>
          <label style={{ display: 'block', fontSize: 12, color: '#4b5563', marginBottom: 4, fontWeight: 500 }}>
            Sync a Google Spreadsheet
            <span style={{ marginLeft: 6, fontSize: 11, color: '#9ca3af', fontWeight: 400 }}>
              (requires Google OAuth setup on the server)
            </span>
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              placeholder="https://docs.google.com/spreadsheets/d/..."
              value={googleUrl}
              onChange={e => setGoogleUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleGoogleSheetConnect(); }}
              style={{
                flex: 1, padding: '6px 10px', borderRadius: 6,
                border: '1px solid #d1d5db', fontSize: 13, outline: 'none',
              }}
            />
            <button
              onClick={handleGoogleSheetConnect}
              disabled={isConnecting || !googleUrl.trim()}
              style={{
                padding: '6px 14px',
                background: isConnecting || !googleUrl.trim() ? '#93c5fd' : '#2563eb',
                color: '#fff', border: 'none', borderRadius: 6,
                cursor: isConnecting || !googleUrl.trim() ? 'not-allowed' : 'pointer',
                fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap',
              }}
            >
              {isConnecting ? 'Syncing…' : 'Sync Link'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
