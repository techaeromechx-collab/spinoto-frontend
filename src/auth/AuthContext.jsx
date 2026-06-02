import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { api, getToken, setToken } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // On mount, if there's a token, try to fetch /me to restore the session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = getToken();
      if (!token) { setLoading(false); return; }
      try {
        const data = await api('/api/me');
        if (!cancelled) setUser(data.user);
      } catch {
        setToken(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: { email, password },
      auth: false,
    });
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  /**
   * Permission check: super admins always pass; otherwise the user's
   * permissions array must include at least one of the given codes.
   *
   *   can('MANAGE_USERS')                    // single
   *   can('VIEW_LEAD', 'EDIT_LEAD')          // any of these
   */
  const can = useCallback((...codes) => {
    if (!user) return false;
    if (user.is_super_admin) return true;
    if (!codes.length) return true;
    const granted = new Set(user.permissions || []);
    return codes.some((c) => granted.has(c));
  }, [user]);

  const value = useMemo(
    () => ({ user, setUser, loading, login, logout, can }),
    [user, loading, login, logout, can]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/**
 * Convenience hook — `const canManageUsers = useCan('MANAGE_USERS');`
 * Pass multiple codes for "any of these".
 */
export function useCan(...codes) {
  const { can } = useAuth();
  return can(...codes);
}
