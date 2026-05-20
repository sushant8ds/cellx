import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Formula {
  id: string;
  name: string;
  target_field_id: string;
  expression: string;
  has_error: boolean;
  error_message?: string;
  created_at: string;
  updated_at: string;
}

export interface AlertRule {
  id: string;
  name: string;
  target_field_id: string;
  operator: 'eq' | 'neq' | 'lt' | 'gt' | 'lte' | 'gte';
  threshold: number | string;
  recipients: string[];
  is_active: boolean;
  has_error: boolean;
  created_at: string;
  updated_at: string;
}

export interface ApiKey {
  id: string;
  name: string;
  role: string;
  last_used?: string;
  status: 'active' | 'revoked';
  created_at: string;
}

export interface ApiKeyCreateResponse extends ApiKey {
  rawKey: string;
}

// ─── Formulas ─────────────────────────────────────────────────────────────────

export function useFormulas(tenantId: string) {
  return useQuery<Formula[]>({
    queryKey: ['formulas', tenantId],
    queryFn: async () => {
      const { data } = await api.get<Formula[]>(`/tenants/${tenantId}/formulas`);
      return data;
    },
    staleTime: 30_000,
    enabled: !!tenantId,
  });
}

export function useCreateFormula(tenantId: string) {
  const qc = useQueryClient();
  return useMutation<Formula, unknown, { name: string; target_field_id: string; expression: string }>({
    mutationFn: (body) =>
      api.post<Formula>(`/tenants/${tenantId}/formulas`, body).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['formulas', tenantId] }),
  });
}

export function useUpdateFormula(tenantId: string) {
  const qc = useQueryClient();
  return useMutation<Formula, unknown, { formulaId: string; name?: string; expression?: string }>({
    mutationFn: ({ formulaId, ...body }) =>
      api.patch<Formula>(`/tenants/${tenantId}/formulas/${formulaId}`, body).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['formulas', tenantId] }),
  });
}

export function useDeleteFormula(tenantId: string) {
  const qc = useQueryClient();
  return useMutation<unknown, unknown, string>({
    mutationFn: (formulaId) =>
      api.delete(`/tenants/${tenantId}/formulas/${formulaId}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['formulas', tenantId] }),
  });
}

// ─── Alert Rules ──────────────────────────────────────────────────────────────

export function useAlertRules(tenantId: string) {
  return useQuery<AlertRule[]>({
    queryKey: ['alert-rules', tenantId],
    queryFn: async () => {
      const { data } = await api.get<AlertRule[]>(`/tenants/${tenantId}/alert-rules`);
      return data;
    },
    staleTime: 30_000,
    enabled: !!tenantId,
  });
}

export function useCreateAlertRule(tenantId: string) {
  const qc = useQueryClient();
  return useMutation<AlertRule, unknown, Omit<AlertRule, 'id' | 'has_error' | 'created_at' | 'updated_at'>>({
    mutationFn: (body) =>
      api.post<AlertRule>(`/tenants/${tenantId}/alert-rules`, body).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alert-rules', tenantId] }),
  });
}

export function useUpdateAlertRule(tenantId: string) {
  const qc = useQueryClient();
  return useMutation<AlertRule, unknown, { ruleId: string } & Partial<Omit<AlertRule, 'id' | 'created_at' | 'updated_at'>>>({
    mutationFn: ({ ruleId, ...body }) =>
      api.patch<AlertRule>(`/tenants/${tenantId}/alert-rules/${ruleId}`, body).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alert-rules', tenantId] }),
  });
}

export function useDeleteAlertRule(tenantId: string) {
  const qc = useQueryClient();
  return useMutation<unknown, unknown, string>({
    mutationFn: (ruleId) =>
      api.delete(`/tenants/${tenantId}/alert-rules/${ruleId}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alert-rules', tenantId] }),
  });
}

export function useTriggerAlertRule(tenantId: string) {
  return useMutation<unknown, unknown, string>({
    mutationFn: (ruleId) =>
      api.post(`/tenants/${tenantId}/alert-rules/${ruleId}/trigger`).then(r => r.data),
  });
}

// ─── API Keys ─────────────────────────────────────────────────────────────────

export function useApiKeys(tenantId: string) {
  return useQuery<ApiKey[]>({
    queryKey: ['api-keys', tenantId],
    queryFn: async () => {
      const { data } = await api.get<ApiKey[]>(`/tenants/${tenantId}/api-keys`);
      return data;
    },
    staleTime: 30_000,
    enabled: !!tenantId,
  });
}

export function useCreateApiKey(tenantId: string) {
  const qc = useQueryClient();
  return useMutation<ApiKeyCreateResponse, unknown, { name: string; role: string }>({
    mutationFn: (body) =>
      api.post<ApiKeyCreateResponse>(`/tenants/${tenantId}/api-keys`, body).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys', tenantId] }),
  });
}

export function useRotateApiKey(tenantId: string) {
  const qc = useQueryClient();
  return useMutation<ApiKeyCreateResponse, unknown, string>({
    mutationFn: (keyId) =>
      api.post<ApiKeyCreateResponse>(`/tenants/${tenantId}/api-keys/${keyId}/rotate`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys', tenantId] }),
  });
}

export function useRevokeApiKey(tenantId: string) {
  const qc = useQueryClient();
  return useMutation<unknown, unknown, string>({
    mutationFn: (keyId) =>
      api.delete(`/tenants/${tenantId}/api-keys/${keyId}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys', tenantId] }),
  });
}

// ─── Schema Fields ────────────────────────────────────────────────────────────

export function useAddField(tenantId: string) {
  const qc = useQueryClient();
  return useMutation<unknown, unknown, { name: string; field_type: string; constraints?: Record<string, unknown> }>({
    mutationFn: (body) =>
      api.post(`/tenants/${tenantId}/schema/fields`, body).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['schema', tenantId] }),
  });
}

export function useRenameField(tenantId: string) {
  const qc = useQueryClient();
  return useMutation<unknown, unknown, { fieldId: string; name: string }>({
    mutationFn: ({ fieldId, name }) =>
      api.patch(`/tenants/${tenantId}/schema/fields/${fieldId}`, { name }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schema', tenantId] });
      qc.invalidateQueries({ queryKey: ['formulas', tenantId] });
      qc.invalidateQueries({ queryKey: ['alert-rules', tenantId] });
    },
  });
}

export function useDeleteField(tenantId: string) {
  const qc = useQueryClient();
  return useMutation<unknown, unknown, string>({
    mutationFn: (fieldId) =>
      api.delete(`/tenants/${tenantId}/schema/fields/${fieldId}`).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schema', tenantId] });
      qc.invalidateQueries({ queryKey: ['formulas', tenantId] });
      qc.invalidateQueries({ queryKey: ['alert-rules', tenantId] });
    },
  });
}
