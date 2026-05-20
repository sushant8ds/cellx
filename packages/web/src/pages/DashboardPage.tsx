import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useDashboard, useSSEStream } from '../hooks/useDashboard';

export default function DashboardPage() {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const navigate = useNavigate();

  const { data: counts, isLoading } = useDashboard(tenantId);

  // Subscribe to SSE stream for real-time updates
  useSSEStream(tenantId);

  if (isLoading) return <div style={{ padding: 24 }}>Loading dashboard…</div>;

  const widgets = [
    { label: 'Safe', count: counts?.safe ?? 0, color: '#10b981', filter: 'Safe' },
    { label: 'Warning', count: counts?.warning ?? 0, color: '#f59e0b', filter: 'Warning' },
    { label: 'Danger', count: counts?.danger ?? 0, color: '#ef4444', filter: 'Danger' },
    { label: 'Overdue', count: counts?.overdue ?? 0, color: '#dc2626', filter: 'Overdue' },
  ];

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 24, marginBottom: 24 }}>Dashboard</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 32 }}>
        {widgets.map(w => (
          <div
            key={w.label}
            onClick={() => navigate(`/grid?filter[status]=${w.filter}`)}
            style={{
              background: '#fff',
              border: `2px solid ${w.color}`,
              borderRadius: 8,
              padding: 20,
              cursor: 'pointer',
              transition: 'transform 0.1s',
            }}
            onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.02)')}
            onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
          >
            <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 8 }}>{w.label}</div>
            <div style={{ fontSize: 32, fontWeight: 600, color: w.color }}>{w.count}</div>
          </div>
        ))}
      </div>

      <div style={{ background: '#f9fafb', padding: 16, borderRadius: 8, marginBottom: 16 }}>
        <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 4 }}>Total Records</div>
        <div style={{ fontSize: 24, fontWeight: 600 }}>{counts?.total ?? 0}</div>
      </div>

      <button
        onClick={() => navigate('/grid')}
        style={{
          padding: '10px 20px',
          fontSize: 14,
          background: '#2563eb',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer',
        }}
      >
        View All Records →
      </button>
    </div>
  );
}
