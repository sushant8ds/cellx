import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import api from '../lib/api';

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  record_count: number;
  status: 'active' | 'suspended';
}

interface HealthData {
  pgPoolTotal: number;
  pgPoolIdle: number;
  pgPoolWaiting: number;
  redisMemory?: string;
  uptime?: number;
}

export default function SystemAdminPage() {
  const [backupMsg, setBackupMsg] = useState<string | null>(null);

  const { data: tenants = [], refetch: refetchTenants } = useQuery<TenantRow[]>({
    queryKey: ['system-admin-tenants'],
    queryFn: () => api.get<TenantRow[]>('/system-admin/tenants').then(r => r.data),
    staleTime: 30_000,
  });

  const { data: health } = useQuery<HealthData>({
    queryKey: ['system-admin-health'],
    queryFn: () => api.get<HealthData>('/system-admin/health').then(r => r.data),
    refetchInterval: 15_000,
  });

  const suspendTenant = useMutation<unknown, unknown, string>({
    mutationFn: (id) => api.post(`/system-admin/tenants/${id}/suspend`).then(r => r.data),
    onSuccess: () => refetchTenants(),
  });

  const activateTenant = useMutation<unknown, unknown, string>({
    mutationFn: (id) => api.post(`/system-admin/tenants/${id}/activate`).then(r => r.data),
    onSuccess: () => refetchTenants(),
  });

  const triggerBackup = useMutation<unknown, unknown, void>({
    mutationFn: () => api.post('/system-admin/backups/trigger').then(r => r.data),
    onSuccess: () => setBackupMsg('Backup triggered successfully.'),
    onError: () => setBackupMsg('Backup trigger failed.'),
  });

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb' }}>
      {/* Header */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '16px 24px' }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#111827' }}>System Admin</h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>Superadmin access only — not linked from main navigation</p>
      </div>

      <div style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>

        {/* 1. Tenant Management */}
        <section style={{ marginBottom: 40 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Tenant Management</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 8, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <thead>
              <tr style={{ background: '#f3f4f6' }}>
                <th style={{ textAlign: 'left', padding: '10px 14px', border: '1px solid #e5e7eb' }}>Name</th>
                <th style={{ textAlign: 'left', padding: '10px 14px', border: '1px solid #e5e7eb' }}>Slug</th>
                <th style={{ textAlign: 'right', padding: '10px 14px', border: '1px solid #e5e7eb' }}>Records</th>
                <th style={{ textAlign: 'left', padding: '10px 14px', border: '1px solid #e5e7eb' }}>Status</th>
                <th style={{ padding: '10px 14px', border: '1px solid #e5e7eb' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map(t => (
                <tr key={t.id}>
                  <td style={{ padding: '10px 14px', border: '1px solid #e5e7eb', fontWeight: 500 }}>{t.name}</td>
                  <td style={{ padding: '10px 14px', border: '1px solid #e5e7eb', color: '#6b7280', fontFamily: 'monospace', fontSize: 13 }}>{t.slug}</td>
                  <td style={{ padding: '10px 14px', border: '1px solid #e5e7eb', textAlign: 'right' }}>{t.record_count.toLocaleString()}</td>
                  <td style={{ padding: '10px 14px', border: '1px solid #e5e7eb' }}>
                    {t.status === 'active'
                      ? <span style={{ background: '#dcfce7', color: '#16a34a', padding: '2px 10px', borderRadius: 12, fontSize: 12 }}>active</span>
                      : <span style={{ background: '#fee2e2', color: '#dc2626', padding: '2px 10px', borderRadius: 12, fontSize: 12 }}>suspended</span>
                    }
                  </td>
                  <td style={{ padding: '10px 14px', border: '1px solid #e5e7eb', textAlign: 'center' }}>
                    {t.status === 'active' ? (
                      <button
                        onClick={() => suspendTenant.mutate(t.id)}
                        disabled={suspendTenant.isPending}
                        style={{ padding: '4px 12px', background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
                      >
                        Suspend
                      </button>
                    ) : (
                      <button
                        onClick={() => activateTenant.mutate(t.id)}
                        disabled={activateTenant.isPending}
                        style={{ padding: '4px 12px', background: '#dcfce7', color: '#166534', border: '1px solid #86efac', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
                      >
                        Activate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {tenants.length === 0 && (
                <tr><td colSpan={5} style={{ padding: 16, textAlign: 'center', color: '#9ca3af' }}>No tenants found</td></tr>
              )}
            </tbody>
          </table>
        </section>

        {/* 2. Platform Health */}
        <section style={{ marginBottom: 40 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Platform Health</h2>
          {health ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
              {[
                { label: 'PG Pool Total', value: health.pgPoolTotal },
                { label: 'PG Pool Idle', value: health.pgPoolIdle },
                { label: 'PG Pool Waiting', value: health.pgPoolWaiting },
                ...(health.redisMemory ? [{ label: 'Redis Memory', value: health.redisMemory }] : []),
                ...(health.uptime !== undefined ? [{ label: 'Uptime (s)', value: health.uptime }] : []),
              ].map(stat => (
                <div key={stat.label} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '14px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{stat.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#111827' }}>{stat.value}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: '#9ca3af' }}>Loading health data…</div>
          )}
        </section>

        {/* 3. Manual Backup */}
        <section>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Manual Backup</h2>
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 20, display: 'inline-block' }}>
            <p style={{ margin: '0 0 12px', color: '#374151', fontSize: 14 }}>
              Trigger a full database backup immediately.
            </p>
            <button
              onClick={() => { setBackupMsg(null); triggerBackup.mutate(); }}
              disabled={triggerBackup.isPending}
              style={{ padding: '8px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
            >
              {triggerBackup.isPending ? 'Triggering…' : 'Trigger Backup'}
            </button>
            {backupMsg && (
              <div style={{ marginTop: 10, fontSize: 13, color: backupMsg.includes('failed') ? '#dc2626' : '#16a34a' }}>
                {backupMsg}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
