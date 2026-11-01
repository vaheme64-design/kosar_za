import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, getAuthToken, setAuthToken, UNAUTHORIZED_EVENT } from '../lib/api';

export interface UserProfile {
  id: string;
  username: string;
  fullName: string;
  role: { id: string; name: string; nameFa: string };
  permissions: string[];
}

interface LoginResponse {
  token: string;
  tokenType: 'Bearer';
  expiresIn: string;
  user: UserProfile;
}

interface AuthContextValue {
  user: UserProfile | null;
  token: string | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [token, setToken] = useState<string | null>(getAuthToken());
  const [loading, setLoading] = useState<boolean>(Boolean(getAuthToken()));

  const logout = useCallback(() => {
    setAuthToken(null);
    setToken(null);
    setUser(null);
  }, []);

  // validate the stored token on mount
  useEffect(() => {
    if (!getAuthToken()) return;
    let cancelled = false;
    api<{ user: UserProfile }>('/auth/me')
      .then((res) => {
        if (!cancelled) {
          setUser(res.user);
          setToken(getAuthToken());
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAuthToken(null);
          setToken(null);
          setUser(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // global 401 handling
  useEffect(() => {
    const handler = () => {
      setToken(null);
      setUser(null);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, handler);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api<LoginResponse>('/auth/login', {
      method: 'POST',
      body: { username, password },
    });
    setAuthToken(res.token);
    setToken(res.token);
    setUser(res.user);
  }, []);

  const can = useCallback(
    (permission: string) => Boolean(user && user.permissions.includes(permission)),
    [user],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ user, token, loading, login, logout, can }),
    [user, token, loading, login, logout, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
