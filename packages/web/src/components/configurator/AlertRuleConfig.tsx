import React, { useState } from 'react';
import { useSchema } from '../../hooks/useRecords';
import {
  useAlertRules,
  useCreateAlertRule,
  useUpdateAlertRule,
  useDeleteAlertRule,
  useTriggerAlertRule,
  AlertRule,
} from '../../hooks/useConfigurator';

interface Props {
  tenantId: string;
}

const OPERATORS = ['eq', 'neq', 'lt', 'gt', 'lte', 'gte'] as const;
const EMPTY_FORM = { name: '', target_field_id: '', operator: 'gt' as AlertRule['operator'], threshold: '', recipients: '' };

export default function AlertRuleConfig({ tenantId }: Props) {
  const { data: rules = [], isLoading } = useAlertRules(tenantId);
  const { data: fields = [] } = useSchema(tenantId);

  const createRule = useCreateAlertRule(tenantId);
  const updateRule = useUpdateAlertRule(tenantId);
  const deleteRule = useDeleteAlertRule(tenantId);
  const triggerRule = useTriggerAlertRule(tenantId);

  const [form, setForm] = useState(EMPTY_FORM);
  const [triggeringId, setTriggeringId] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.target_field_id) return;
    await createRule.mutateAsync({
      name: form.name.trim(),
      target_field_id: form.target_field_id,
      operator: form.operator,
      threshold: form.threshold,
      recipients: form.recipients.split(',').map(s => s.trim()).filter(Boolean),
      is_active: true,
    });
    setForm(EMPTY_FORM);
  }

  async function handleTrigger(ruleId: string) {
    setTriggeringId(ruleId);
    try {
      await triggerRule.mutateAsync(ruleId);
    } finally {
      setTriggeringId(null);
    }
  }

  function statusBadge(rule: AlertRule) {
    if (rule.has_error) return <span style={{ background: '#fee2e2', color: '#dc2626', padding: '2px 8px', borderRadius: 12, fontSize: 12 }}>error</span>;
    if (rule.is_active) return <span style={{ background: '#dcfce7', color: '#16a34a', padding: '2px 8px', borderRadius: 12, fontSize: 12 }}>active</span>;
    return <span style={{ background: '#f3f4f6', color: '#6b7280', padding: '2px 8px', borderRadius: 12, fontSize: 12 }}>inactive</span>;
  }

  if (isLoading) return <div style={{ padding: 16 }}>Loading alert rules...</div>;

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>Alert Rules</h2>

      {/* Add rule form */}
      <form onSubmit={handleCreate} style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 24 }}>
        <h3 style={{ marginTop: 0, fontSize: 14, color: '#374151' }}>New Alert Rule</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <input
            value={form.name}
            onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
            placeholder="Rule name"
            style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 4 }}
          />
          <select
            value={form.target_field_id}
            onChange={e => setForm(p => ({ ...p, target_field_id: e.target.value }))}
            style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 4 }}
          >
            <option value="">— Target field —</option>
            {fields.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <select
            value={form.operator}
            onChange={e => setForm(p => ({ ...p, operator: e.target.value as AlertRule['operator'] }))}
            style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 4 }}
          >
            {OPERATORS.map(op => <option key={op} value={op}>{op}</option>)}
          </select>
          <input
            value={form.threshold}
            onChange={e => setForm(p => ({ ...p, threshold: e.target.value }))}
            placeholder="Threshold"
            style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 4 }}
          />
          <input
            value={form.recipients}
            onChange={e => setForm(p => ({ ...p, recipients: e.target.value }))}
            placeholder="Recipients (comma-separated emails)"
            style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 4, gridColumn: '1 / -1' }}
          />
        </div>
        <button
          type="submit"
          disabled={createRule.isPending}
          style={{ marginTop: 10, padding: '6px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
        >
          {createRule.isPending ? 'Saving…' : 'Add Rule'}
        </button>
      </form>

      {/* Rules list */}
      {rules.length === 0 && <p style={{ color: '#9ca3af' }}>No alert rules yet.</p>}
      {rules.map(rule => (
        <div key={rule.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontWeight: 600 }}>{rule.name}</span>
            {statusBadge(rule)}
          </div>
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 4 }}>
            Field: <code>{fields.find(f => f.id === rule.target_field_id)?.name ?? rule.target_field_id}</code>
            {' · '}
            Condition: <code>{rule.operator} {rule.threshold}</code>
          </div>
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 10 }}>
            Recipients: {rule.recipients.join(', ') || '—'}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              onClick={() => updateRule.mutate({ ruleId: rule.id, is_active: !rule.is_active })}
              disabled={updateRule.isPending}
              style={{ padding: '4px 12px', background: rule.is_active ? '#fef3c7' : '#dcfce7', color: rule.is_active ? '#92400e' : '#166534', border: '1px solid currentColor', borderRadius: 4, cursor: 'pointer' }}
            >
              {rule.is_active ? 'Deactivate' : 'Activate'}
            </button>
            <button
              onClick={() => handleTrigger(rule.id)}
              disabled={triggeringId === rule.id}
              style={{ padding: '4px 12px', background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', borderRadius: 4, cursor: 'pointer' }}
            >
              {triggeringId === rule.id ? 'Triggering…' : 'Trigger Now'}
            </button>
            <button
              onClick={() => deleteRule.mutate(rule.id)}
              disabled={deleteRule.isPending}
              style={{ padding: '4px 12px', background: '#fee2e2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: 4, cursor: 'pointer' }}
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
