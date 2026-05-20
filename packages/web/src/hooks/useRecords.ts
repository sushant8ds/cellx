import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';

export interface DynamicField {
  id: string;
  name: string;
  field_type: 'text' | 'integer' | 'float' | 'date' | 'status';
  dropdown_values?: string[];
  constraints?: Record<string, unknown>;
  display_order: number;
}

export interface DataRecord {
  id: string;
  tenant_id: string;
  data: Record<string, unknown>;
  version: number;
  is_deleted: boolean;
  deleted_at?: string;
  created_at: string;
  updated_at: string;
}

export interface RecordsResponse {
  records: DataRecord[];
  nextCursor?: string;
}

export interface RecordsOptions {
  limit?: number;
  cursor?: string;
  sort_by?: string;
  filters?: Record<string, string>;
  archived?: boolean;
}

export function useRecords(tenantId: string, options: RecordsOptions = {}) {
  return useQuery<RecordsResponse>({
    queryKey: ['records', tenantId, options],
    queryFn: async () => {
      const params: Record<string, string> = { limit: String(options.limit ?? 100) };
      if (options.cursor) params.cursor = options.cursor;
      if (options.sort_by) params.sort_by = options.sort_by;
      if (options.archived !== undefined) params.archived = String(options.archived);
      if (options.filters) {
        for (const [k, v] of Object.entries(options.filters)) {
          params[`filter[${k}]`] = v;
        }
      }
      const { data } = await api.get<RecordsResponse>(`/tenants/${tenantId}/records`, { params });
      return data;
    },
    staleTime: 10_000,
    enabled: !!tenantId,
  });
}

export function useUpdateRecord(tenantId: string) {
  const qc = useQueryClient();
  return useMutation<unknown, unknown, { recordId: string; data: Record<string, unknown>; version: number }>({
    mutationFn: ({ recordId, data, version }) =>
      api.patch(`/tenants/${tenantId}/records/${recordId}`, { data, version }).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['records', tenantId] }),
  });
}

export function useDeleteRecord(tenantId: string) {
  const qc = useQueryClient();
  return useMutation<unknown, unknown, string>({
    mutationFn: (recordId) => api.delete(`/tenants/${tenantId}/records/${recordId}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['records', tenantId] }),
  });
}

export function useBulkUpdate(tenantId: string) {
  const qc = useQueryClient();
  return useMutation<unknown, unknown, { recordIds: string[]; fieldId: string; value: unknown }>({
    mutationFn: (payload) =>
      api.post(`/tenants/${tenantId}/records/bulk-update`, payload).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['records', tenantId] }),
  });
}

export function useBulkDelete(tenantId: string) {
  const qc = useQueryClient();
  return useMutation<unknown, unknown, { recordIds: string[] }>({
    mutationFn: (payload) =>
      api.post(`/tenants/${tenantId}/records/bulk-delete`, payload).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['records', tenantId] }),
  });
}

export function useRestoreRecord(tenantId: string) {
  const qc = useQueryClient();
  return useMutation<unknown, unknown, string>({
    mutationFn: (recordId) =>
      api.post(`/tenants/${tenantId}/records/${recordId}/restore`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['records', tenantId] }),
  });
}

export function useSchema(tenantId: string) {
  return useQuery<DynamicField[]>({
    queryKey: ['schema', tenantId],
    queryFn: async () => {
      const { data } = await api.get<DynamicField[]>(`/tenants/${tenantId}/schema`);
      return data;
    },
    staleTime: 30_000,
    enabled: !!tenantId,
  });
}
