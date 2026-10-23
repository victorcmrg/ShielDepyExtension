// Sessão do portal: quem está logado (GET /api/auth/me). Fica num contexto acima das rotas pra não
// buscar de novo a cada troca de tela; o Shell revalida em segundo plano a cada navegação.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Me } from './types';

export type AuthState = { status: 'loading' } | { status: 'anon' } | { status: 'ready'; me: Me };

interface Auth {
  state: AuthState;
  /** Busca /api/auth/me de novo. Erro de rede mantém o estado atual (não manda pro login à toa). */
  refresh(): Promise<Me | null>;
  logout(): Promise<void>;
}

const AuthContext = createContext<Auth | null>(null);

export function useAuth(): Auth {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth fora do AuthProvider');
  return auth;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  const refresh = useCallback(async () => {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
    const me = res.ok ? ((await res.json()) as Me) : null;
    setState(me ? { status: 'ready', me } : { status: 'anon' });
    return me;
  }, []);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    setState({ status: 'anon' });
  }, []);

  const auth = useMemo(() => ({ state, refresh, logout }), [state, refresh, logout]);
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}
