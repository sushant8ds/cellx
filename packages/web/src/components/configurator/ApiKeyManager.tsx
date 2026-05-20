import React, { useState } from 'react';
import { useApiKeys, useCreateApiKey, useRotateApiKey, useRevokeApiKey, ApiKey } from '../../hooks/useConfigurator';

interface Props {
  tenantId: string;
}

const ROLES = ['admin', 'manager', 'operator'];

export default function ApiKeyManager({ tenantId }: Props) {
  const { data: keys = [], isLoading } = useApiKeys(tenantId);
  const createKey = useCreateApiKey(tenantId);
  const rotateKey = useRotateApiKey(tenantId);
  const revokeKey = useRevokeApiKey(tenantId);

  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('operator');
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    const result = await createKey.mutateAsync({ name: newName.trim(), role: newRole });
    setRawKey(result.rawKey);
    setNewName('');
    setNewRole('operator');
  }

  async function handleRotate(keyId: string) {
    const result = await rotateKey.mutateAsync(keyId);
    setRawKey(result.rawKey);
  }

  async function handleRevoke() {
    if (!revokeTarget) return;
    await revokeKey.mutateAsync(revokeTarget.id);
    setRevokeTarget(null);
  }

  function copyKey() {
    if (!rawKey) return;
    navigator.clipboard.writeText(rawKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (isLoading) return <div style={{ padding: 16 }}>Loading API keys...</div>;

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>API Keys</h2>

      {/* Generate new key form */}
      <form onSubmit={handleCreate} style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="Key name"
          style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 4, minWidth: 160 }}
        />
        <select
          value={newRole}
          onChange={e => setNewRole(e.target.value)}
          style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 4 }}
        >
          {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <button
          type="submit"
          disabled={createKey.isPending}
          style={{ padding: '6px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
        >
          {createKey.isPending ? 'Generating…' : 'Generate Key'}
        </button>
      </form>

      {/* Keys table */}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#f3f4f6' }}>
            <th style={{ textAlign: 'left', padding: '8px 12px', border: '1px solid #e5e7eb' }}>Name</th>
            <th style={{ textAlign: 'left', padding: '8px 12px', border: '1px solid #e5e7eb' }}>Role</th>
            <th style={{ textAlign: 'left', padding: '8px 12px', border: '1px solid #e5e7eb' }}>Last Used</th>
            <th style={{ textAlign: 'left', padding: '8px 12px', border: '1px solid #e5e7eb' }}>Status</th>
            <th style={{ padding: '8px 12px', border: '1px solid #e5e7eb' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {keys.map(key => (
            <tr key={key.id}>
              <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb' }}>{key.name}</td>
              <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb' }}>
                <span style={{ background: '#e0e7ff', color: '#3730a3', padding: '2px 8px', borderRadius: 12, fontSize: 12 }}>{key.role}</span>
              </td>
              <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb', color: '#6b7280', fontSize: 13 }}>
                {key.last_used ? new Date(key.last_used).toLocaleString() : '—'}
              </td>
              <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb' }}>
                {key.status === 'active'
                  ? <span style={{ background: '#dcfce7', color: '#16a34a', padding: '2px 8px', borderRadius: 12, fontSize: 12 }}>active</span>
                  : <span style={{ background: '#f3f4f6', color: '#6b7280', padding: '2px 8px', borderRadius: 12, fontSize: 12 }}>revoked</span>
                }
              </td>
              <td style={{ padding: '8px 12px', border: '1px solid #e5e7eb', textAlign: 'center' }}>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                  {key.status === 'active' && (
                    <>
                      <button
                        onClick={() => handleRotate(key.id)}
                        disabled={rotateKey.isPending}
                        style={{ padding: '4px 10px', background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
                      >
                        Rotate
                      </button>
                      <button
                        onClick={() => setRevokeTarget(key)}
                        style={{ padding: '4px 10px', background: '#fee2e2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
                      >
                        Revoke
                      </button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {keys.length === 0 && (
            <tr><td colSpan={5} style={{ padding: 16, textAlign: 'center', color: '#9ca3af' }}>No API keys yet</td></tr>
          )}
        </tbody>
      </table>

      {/* Raw key modal */}
      {rawKey && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 8, padding: 24, maxWidth: 480, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <h3 style={{ marginTop: 0 }}>Your API Key</h3>
            <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 6, padding: 10, marginBottom: 12, fontSize: 13 }}>
              ⚠ <strong>This key will not be shown again.</strong> Copy it now and store it securely.
            </div>
            <div style={{ fontFamily: 'monospace', background: '#f3f4f6', padding: '10px 14px', borderRadius: 6, wordBreak: 'break-all', marginBottom: 16, fontSize: 13 }}>
              {rawKey}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={copyKey}
                style={{ padding: '8px 16px', background: copied ? '#16a34a' : '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
              <button
                onClick={() => { setRawKey(null); setCopied(false); }}
                style={{ padding: '8px 16px', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', background: '#fff' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Revoke confirmation modal */}
      {revokeTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 8, padding: 24, maxWidth: 380, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <h3 style={{ marginTop: 0, color: '#dc2626' }}>Revoke API Key</h3>
            <p>Revoke <strong>{revokeTarget.name}</strong>? This cannot be undone.</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setRevokeTarget(null)} style={{ padding: '8px 16px', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', background: '#fff' }}>Cancel</button>
              <button
                onClick={handleRevoke}
                disabled={revokeKey.isPending}
                style={{ padding: '8px 16px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
              >
                {revokeKey.isPending ? 'Revoking…' : 'Revoke'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
