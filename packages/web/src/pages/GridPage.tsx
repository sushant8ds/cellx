import React, { useState } from 'react';
import { useAuth } from '../lib/auth';
import Grid from '../components/Grid';
import ArchiveView from '../components/ArchiveView';
import BulkUpdateModal from '../components/BulkUpdateModal';
import ExportDialog from '../components/ExportDialog';
import { useSchema, useBulkDelete } from '../hooks/useRecords';

const btn: React.CSSProperties = { padding: '6px 14px', fontSize: 13, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' };

export default function GridPage() {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const [showArchive, setShowArchive] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showBulkUpdate, setShowBulkUpdate] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showExport, setShowExport] = useState(false);

  const { data: schema = [] } = useSchema(tenantId);
  const bulkDelete = useBulkDelete(tenantId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', padding: 16 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 18, flex: 1 }}>Records</h1>
        <button onClick={() => setShowArchive(v => !v)} style={btn}>{showArchive ? 'View Active' : 'View Archive'}</button>
        {!showArchive && <>
          <button onClick={() => setShowExport(true)} style={btn}>Export</button>
          {selectedIds.length > 0 && <>
            <button onClick={() => setShowBulkUpdate(true)} style={btn}>Bulk Update ({selectedIds.length})</button>
            <button onClick={() => setShowDeleteConfirm(true)} style={{ ...btn, background: '#dc2626' }}>Bulk Delete ({selectedIds.length})</button>
          </>}
        </>}
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {showArchive ? <ArchiveView tenantId={tenantId} /> : <Grid tenantId={tenantId} onSelectionChange={setSelectedIds} />}
      </div>
      <BulkUpdateModal open={showBulkUpdate} onClose={() => setShowBulkUpdate(false)} tenantId={tenantId} selectedIds={selectedIds} schema={schema} />
      {showExport && <ExportDialog tenantId={tenantId} onClose={() => setShowExport(false)} />}
      {showDeleteConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#fff', borderRadius: 8, padding: 24, minWidth: 320 }}>
            <p style={{ margin: '0 0 16px', fontSize: 14 }}>Delete {selectedIds.length} record{selectedIds.length !== 1 ? 's' : ''}?</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowDeleteConfirm(false)} style={{ ...btn, background: '#f3f4f6', color: '#374151' }}>Cancel</button>
              <button onClick={async () => { await bulkDelete.mutateAsync({ recordIds: selectedIds }); setSelectedIds([]); setShowDeleteConfirm(false); }} disabled={bulkDelete.isPending} style={{ ...btn, background: '#dc2626' }}>
                {bulkDelete.isPending ? 'Deleting…' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
