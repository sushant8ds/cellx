import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export const TOKEN_KEY = 'udcp_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export interface TokenPayload {
  userId: string;
  tenantId: string;
  role: string;
  isSuperadmin: boolean;
}

export function parseToken(token: string): TokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));
    return {
      userId: payload.userId ?? payload.sub ?? '',
      tenantId: payload.tenantId ?? payload.tenant_id ?? '',
      role: payload.role ?? '',
      isSuperadmin: payload.isSuperadmin ?? payload.is_superadmin ?? false,
    };
  } catch {
    return null;
  }
}

export function useAuth() {
  const [user, setUser] = useState<TokenPayload | null>(() => {
    const token = getToken();
    return token ? parseToken(token) : null;
  });
  const navigate = useNavigate();

  function login(token: string) {
    setToken(token);
    setUser(parseToken(token));
  }

  function logout() {
    clearToken();
    setUser(null);
    navigate('/login');
  }

  return {
    user,
    isAuthenticated: user !== null,
    login,
    logout,
  };
}
