import React, { useState } from 'react';
import { useSchema } from '../../hooks/useRecords';
import { useFormulas, useCreateFormula, useUpdateFormula, useDeleteFormula, Formula } from '../../hooks/useConfigurator';

interface Props {
  tenantId: string;
}

const EMPTY_FORM = { name: '', target_field_id: '', expression: '' };

export default function FormulaBuilder({ tenantId }: Props) {
  const { data: formulas = [], isLoading } = useFormulas(tenantId);
  const { data: fields = [] } = useSchema(tenantId);

  const createFormula = useCreateFormula(tenantId);
  const updateFormula = useUpdateFormula(tenantId);
  const deleteFormula = useDeleteFormula(tenantId);

  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.target_field_id || !form.expression.trim()) return;
    await createFormula.mutateAsync(form);
    setForm(EMPTY_FORM);
  }

  function startEdit(f: Formula) {
    setEditingId(f.id);
    setEditForm({ name: f.name, target_field_id: f.target_field_id, expression: f.expression });
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    await updateFormula.mutateAsync({ formulaId: editingId, name: editForm.name, expression: editForm.expression });
    setEditingId(null);
  }

  function statusBadge(f: Formula) {
    if (f.has_error) return <span style={{ background: '#fee2e2', color: '#dc2626', padding: '2px 8px', borderRadius: 12, fontSize: 12 }}>error</span>;
    return <span style={{ background: '#dcfce7', color: '#16a34a', padding: '2px 8px', borderRadius: 12, fontSize: 12 }}>active</span>;
  }

  if (isLoading) return <div style={{ padding: 16 }}>Loading formulas...</div>;

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>Formula Builder</h2>

      {/* Add formula form */}
      <form onSubmit={handleCreate} style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 24 }}>
        <h3 style={{ marginTop: 0, fontSize: 14, color: '#374151' }}>New Formula</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input
            value={form.name}
            onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
            placeholder="Formula name"
            style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 4 }}
          />
          <select
            value={form.target_field_id}
            onChange={e => setForm(p => ({ ...p, target_field_id: e.target.value }))}
            style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 4 }}
          >
            <option value="">— Select target field —</option>
            {fields.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <textarea
            value={form.expression}
            onChange={e => setForm(p => ({ ...p, expression: e.target.value }))}
            placeholder="Expression, e.g. [field_id] * 1.1"
            rows={3}
            style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 4, fontFamily: 'monospace', resize: 'vertical' }}
          />
          <p style={{ margin: 0, fontSize: 12, color: '#6b7280' }}>
            Use <code>[fieldId]</code> to reference fields. Supports <code>+, -, *, /, IF(), DATE_ADD()</code>
          </p>
          <button
            type="submit"
            disabled={createFormula.isPending}
            style={{ alignSelf: 'flex-start', padding: '6px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
          >
            {createFormula.isPending ? 'Saving…' : 'Add Formula'}
          </button>
        </div>
      </form>

      {/* Formulas list */}
      {formulas.length === 0 && <p style={{ color: '#9ca3af' }}>No formulas yet.</p>}
      {formulas.map(f => (
        <div key={f.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 12 }}>
          {editingId === f.id ? (
            <form onSubmit={handleUpdate} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input
                value={editForm.name}
                onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))}
                style={{ padding: '6px 10px', border: '1px solid #2563eb', borderRadius: 4 }}
              />
              <textarea
                value={editForm.expression}
                onChange={e => setEditForm(p => ({ ...p, expression: e.target.value }))}
                rows={3}
                style={{ padding: '6px 10px', border: '1px solid #2563eb', borderRadius: 4, fontFamily: 'monospace', resize: 'vertical' }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" disabled={updateFormula.isPending} style={{ padding: '4px 12px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>Save</button>
                <button type="button" onClick={() => setEditingId(null)} style={{ padding: '4px 12px', background: '#6b7280', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>Cancel</button>
              </div>
            </form>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontWeight: 600 }}>{f.name}</span>
                {statusBadge(f)}
              </div>
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 4 }}>
                Target: <code>{fields.find(x => x.id === f.target_field_id)?.name ?? f.target_field_id}</code>
              </div>
              <div style={{ fontFamily: 'monospace', fontSize: 13, background: '#f3f4f6', padding: '6px 10px', borderRadius: 4, marginBottom: 8 }}>
                {f.expression}
              </div>
              {f.has_error && f.error_message && (
                <div style={{ color: '#dc2626', fontSize: 12, marginBottom: 8 }}>{f.error_message}</div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => startEdit(f)} style={{ padding: '4px 12px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer' }}>Edit</button>
                <button
                  onClick={() => deleteFormula.mutate(f.id)}
                  disabled={deleteFormula.isPending}
                  style={{ padding: '4px 12px', background: '#fee2e2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: 4, cursor: 'pointer' }}
                >
                  Delete
                </button>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
