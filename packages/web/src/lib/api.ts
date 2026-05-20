import axios from 'axios';
import { getToken, clearToken } from './auth';

// Use relative URL so Vite proxy handles it — no CORS issues
const api = axios.create({
  baseURL: '',
});

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      clearToken();
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export const auth = {
  login: async (email: string, password: string, tenantSlug: string): Promise<{ token: string }> => {
    const { data } = await api.post<{ token: string }>('/auth/login', { email, password, tenantSlug });
    return data;
  },
  ssoSaml: (tenantSlug: string): void => {
    window.location.href = `/auth/sso/saml?tenant=${encodeURIComponent(tenantSlug)}`;
  },
};

export default api;
