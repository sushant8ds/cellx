import React, { useState } from 'react';
import { useBulkUpdate, type DynamicField } from '../hooks/useRecords';

interface Props {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  selectedIds: string[];
  schema: DynamicField[];
}

const btn: React.CSSProperties = { padding: '6px 16px', fontSize: 13, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' };

export default function BulkUpdateModal({ open, onClose, tenantId, selectedIds, schema }: Props) {
  const [fieldId, setFieldId] = useState('');
  const [value, setValue] = useState('');
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const bulkUpdate = useBulkUpdate(tenantId);

  if (!open) return null;

  const selectedField = schema.find(f => f.id === fieldId);

  async function handleConfirm() {
    if (!fieldId) return;
    try {
      await bulkUpdate.mutateAsync({ recordIds: selectedIds, fieldId, value });
      setStatus('success');
    } catch { setStatus('error'); }
  }

  function handleClose() { setFieldId(''); setValue(''); setStatus('idle'); onClose(); }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div style={{ background: '#fff', borderRadius: 8, padding: 24, minWidth: 360, boxShadow: '0 4px 24px rgba(0,0,0,0.15)' }}>
        <h2 style={{ margin: '0 0 16px', fontSize: 16 }}>Bulk Update — {selectedIds.length} record{selectedIds.length !== 1 ? 's' : ''}</h2>
        {status === 'success' ? (
          <div><p style={{ color: '#16a34a' }}>Update applied successfully.</p><button onClick={handleClose} style={btn}>Close</button></div>
        ) : (
          <>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>Field</label>
              <select value={fieldId} onChange={e => setFieldId(e.target.value)} style={{ width: '100%', padding: '6px 8px', fontSize: 13 }}>
                <option value="">Select a field…</option>
                {schema.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>New Value</label>
              {selectedField?.field_type === 'status' && selectedField.dropdown_values ? (
                <select value={value} onChange={e => setValue(e.target.value)} style={{ width: '100%', padding: '6px 8px', fontSize: 13 }}>
                  <option value="">Select…</option>
                  {selectedField.dropdown_values.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              ) : (
                <input type="text" value={value} onChange={e => setValue(e.target.value)} style={{ width: '100%', padding: '6px 8px', fontSize: 13, boxSizing: 'border-box' }} />
              )}
            </div>
            {status === 'error' && <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>Bulk update failed. Please try again.</p>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={handleClose} style={{ ...btn, background: '#f3f4f6', color: '#374151' }}>Cancel</button>
              <button onClick={handleConfirm} disabled={!fieldId || bulkUpdate.isPending} style={{ ...btn, opacity: !fieldId || bulkUpdate.isPending ? 0.5 : 1 }}>
                {bulkUpdate.isPending ? 'Updating…' : 'Apply'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
