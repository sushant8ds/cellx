import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import api from '../lib/api';

export interface DashboardCounts {
  safe: number;
  warning: number;
  danger: number;
  overdue: number;
  total: number;
}

export function useDashboard(tenantId: string) {
  return useQuery<DashboardCounts>({
    queryKey: ['dashboard', tenantId],
    queryFn: async () => {
      const { data } = await api.get<DashboardCounts>(`/tenants/${tenantId}/dashboard`);
      return data;
    },
    staleTime: 30_000,
    enabled: !!tenantId,
  });
}

// Subscribe to SSE stream and update TanStack Query cache on events
export function useSSEStream(tenantId: string) {
  const qc = useQueryClient();
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!tenantId) return;

    const token = localStorage.getItem('udcp_token');
    // Use relative URL — Vite proxy handles it, no CORS
    const url = `/tenants/${tenantId}/events/stream?token=${token ?? ''}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener('dashboard_update', (e: MessageEvent) => {
      try {
        const counts = JSON.parse(e.data) as DashboardCounts;
        qc.setQueryData(['dashboard', tenantId], counts);
      } catch { /* ignore parse errors */ }
    });

    es.addEventListener('record_update', (e: MessageEvent) => {
      try {
        const updatedRecord = JSON.parse(e.data) as { id: string };
        // Patch the specific record in the cache, fall back to full invalidation
        const existing = qc.getQueryData<{ records: unknown[] }>(['records', tenantId]);
        if (existing) {
          qc.setQueryData(['records', tenantId], {
            ...existing,
            records: existing.records.map((r: unknown) => {
              const rec = r as { id: string };
              return rec.id === updatedRecord.id ? updatedRecord : r;
            }),
          });
        } else {
          qc.invalidateQueries({ queryKey: ['records', tenantId] });
        }
      } catch { /* ignore */ }
    });

    es.onerror = () => {
      // Reconnect handled automatically by EventSource
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [tenantId, qc]);
}
