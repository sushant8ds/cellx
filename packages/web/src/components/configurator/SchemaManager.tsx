import React, { useState } from 'react';
import { useSchema, DynamicField } from '../../hooks/useRecords';
import { useAddField, useRenameField, useDeleteField } from '../../hooks/useConfigurator';
import { useFormulas, useAlertRules } from '../../hooks/useConfigurator';

interface Props {
  tenantId: string;
}

const FIELD_TYPES = ['text', 'integer', 'float', 'date', 'status'] as const;

export default function SchemaManager({ tenantId }: Props) {
  const { data: fields = [], isLoading } = useSchema(tenantId);
  const { data: formulas = [] } = useFormulas(tenantId);
  const { data: alertRules = [] } = useAlertRules(tenantId);

  const addField = useAddField(tenantId);
  const renameField = useRenameField(tenantId);
  const deleteField = useDeleteField(tenantId);

  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<string>('text');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<DynamicField | null>(null);

  function countDependencies(fieldId: string) {
    const affectedFormulas = formulas.filter(f => f.expression.includes(fieldId)).length;
    const affectedAlerts = alertRules.filter(r => r.target_field_id === fieldId).length;
    return { affectedFormulas, affectedAlerts };
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    await addField.mutateAsync({ name: newName.trim(), field_type: newType });
    setNewName('');
    setNewType('text');
  }

  function startEdit(field: DynamicField) {
    setEditingId(field.id);
    setEditingName(field.name);
  }

  async function saveEdit(fieldId: string) {
    if (!editingName.trim()) return;
    await renameField.mutateAsync({ fieldId, name: editingName.trim() });
    setEditingId(null);
  }

  function confirmDelete(field: DynamicField) {
    setDeleteTarget(field);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await deleteField.mutateAsync(deleteTarget.id);
    setDeleteTarget(null);
  }

  if (isLoading) return <div style={{ padding: 16 }}>Loading schema...</div>;

  const { affectedFormulas, affectedAlerts } = deleteTarget
    ? countDependencies(deleteTarget.id)
    : { affectedFormulas: 0, affectedAlerts: 0 };

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>Dynamic Fields</h2>

      {/* Add field form */}
      <form onSubmit={handleAdd} style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="Field name"
          style={{ padding: '6px 10px', border: '1px solid #ccc', borderRadius: 4, minWidth: 160 }}
        />
        <select
          value={newType}
          onChange={e => setNewType(e.target.value)}
          style={{ padding: '6px 10px', border: '1px solid #ccc', borderRadius: 4 }}
        >
          {FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <button
          type="submit"
          disabled={addField.isPending}
          style={{ padding: '6px 14px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
        >
          {addField.isPending ? 'Adding…' : 'Add Field'}
        </button>
      </form>

      {/* Fields table */}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#f3f4f6' }}>
            <th style={{ textAlign: 'left', padding: '8px 12px', border: '1px solid #e5e7eb' }}>Name</th>
            <th style={{ textAlign: 'left', padding: '8px 12px', border: '1px solid #e5e7eb' }}>Type</th>
            <th style={{ textAlign: 'left', padding: '8px 12px', border: '1px solid #e5e7eb' }}>Order</th>
            <th style={{ padding: '8px 12px', border: '1px solid #e5e7eb' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {fields.map(field => (
            <tr key={field.id}>
              <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb' }}>
                {editingId === field.id ? (
                  <span style={{ display: 'flex', gap: 6 }}>
                    <input
                      value={editingName}
                      onChange={e => setEditingName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') saveEdit(field.id); if (e.key === 'Escape') setEditingId(null); }}
                      autoFocus
                      style={{ padding: '4px 8px', border: '1px solid #2563eb', borderRadius: 4 }}
                    />
                    <button onClick={() => saveEdit(field.id)} style={{ padding: '4px 10px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>Save</button>
                    <button onClick={() => setEditingId(null)} style={{ padding: '4px 10px', background: '#6b7280', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>Cancel</button>
                  </span>
                ) : (
                  <span
                    onClick={() => startEdit(field)}
                    style={{ cursor: 'pointer', textDecoration: 'underline dotted', color: '#1d4ed8' }}
                    title="Click to rename"
                  >
                    {field.name}
                  </span>
                )}
              </td>
              <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb' }}>
                <span style={{ background: '#e0e7ff', color: '#3730a3', padding: '2px 8px', borderRadius: 12, fontSize: 12 }}>
                  {field.field_type}
                </span>
              </td>
              <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb', color: '#6b7280' }}>{field.display_order}</td>
              <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb', textAlign: 'center' }}>
                <button
                  onClick={() => confirmDelete(field)}
                  style={{ padding: '4px 10px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {fields.length === 0 && (
            <tr><td colSpan={4} style={{ padding: 16, textAlign: 'center', color: '#9ca3af' }}>No fields yet</td></tr>
          )}
        </tbody>
      </table>

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 8, padding: 24, maxWidth: 420, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <h3 style={{ marginTop: 0, color: '#dc2626' }}>Delete Field</h3>
            <p>Are you sure you want to delete <strong>{deleteTarget.name}</strong>?</p>
            {(affectedFormulas > 0 || affectedAlerts > 0) && (
              <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, padding: 12, marginBottom: 16 }}>
                <strong>⚠ Dependency Warning</strong>
                <p style={{ margin: '8px 0 0' }}>
                  This will invalidate{' '}
                  {affectedFormulas > 0 && <><strong>{affectedFormulas}</strong> formula{affectedFormulas !== 1 ? 's' : ''}</>}
                  {affectedFormulas > 0 && affectedAlerts > 0 && ' and '}
                  {affectedAlerts > 0 && <><strong>{affectedAlerts}</strong> alert rule{affectedAlerts !== 1 ? 's' : ''}</>}.
                  {' '}Confirm?
                </p>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setDeleteTarget(null)} style={{ padding: '8px 16px', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', background: '#fff' }}>Cancel</button>
              <button
                onClick={handleDelete}
                disabled={deleteField.isPending}
                style={{ padding: '8px 16px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
              >
                {deleteField.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
