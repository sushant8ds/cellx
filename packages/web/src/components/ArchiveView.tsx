import React from 'react';
import { useRecords, useRestoreRecord } from '../hooks/useRecords';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export default function ArchiveView({ tenantId }: { tenantId: string }) {
  const { data, isLoading } = useRecords(tenantId, { archived: true, limit: 100 });
  const restore = useRestoreRecord(tenantId);

  if (isLoading) return <div style={{ padding: 16 }}>Loading archived records…</div>;
  const records = data?.records ?? [];
  if (records.length === 0) return <div style={{ padding: 16, color: '#6b7280' }}>No archived records.</div>;

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ fontSize: 16, marginBottom: 12 }}>Archived Records ({records.length})</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#f9fafb' }}>
            <th style={th}>ID</th>
            <th style={th}>Deleted At</th>
            <th style={th}>Action</th>
          </tr>
        </thead>
        <tbody>
          {records.map(rec => {
            const expired = rec.deleted_at ? Date.now() - new Date(rec.deleted_at).getTime() > THIRTY_DAYS_MS : false;
            return (
              <tr key={rec.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={td}>{rec.id}</td>
                <td style={td}>{rec.deleted_at ? new Date(rec.deleted_at).toLocaleString() : '—'}</td>
                <td style={td}>
                  {expired ? (
                    <span style={{ color: '#9ca3af', fontSize: 12 }}>Restore window expired</span>
                  ) : (
                    <button onClick={() => restore.mutate(rec.id)} disabled={restore.isPending}
                      style={{ padding: '3px 10px', fontSize: 12, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                      Restore
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const th: React.CSSProperties = { padding: '6px 8px', textAlign: 'left', fontWeight: 600, borderBottom: '1px solid #e5e7eb' };
const td: React.CSSProperties = { padding: '6px 8px' };
