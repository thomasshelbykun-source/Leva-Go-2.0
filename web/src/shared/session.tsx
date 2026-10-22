import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api, getToken, setToken, type Api, type AppName } from './api';
import { Loading } from './ui';

export interface Me {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  locale: string;
  theme: 'system' | 'light' | 'dark';
  notify_prefs: { promos?: boolean };
  roles: string[];
  app: AppName;
}

interface SessionCtx {
  app: AppName;
  base: string;
  api: Api;
  me: Me | null;
  loading: boolean;
  signIn: (token: string) => Promise<void>;
  signOut: (all?: boolean) => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ app, base, children }: { app: AppName; base: string; children: ReactNode }) {
  const client = useMemo(() => api(app), [app]);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(!!getToken(app));

  const refresh = useCallback(async () => {
    if (!getToken(app)) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      setMe(await client.get<Me>('/auth/me'));
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, [app, client]);

  useEffect(() => {
    void refresh();
    const onChange = (e: Event) => {
      if ((e as CustomEvent).detail === app && !getToken(app)) setMe(null);
    };
    window.addEventListener('levago:session', onChange);
    return () => window.removeEventListener('levago:session', onChange);
  }, [app, refresh]);

  // Tema escolhido no perfil.
  useEffect(() => {
    document.documentElement.dataset.theme = me?.theme && me.theme !== 'system' ? me.theme : '';
  }, [me?.theme]);

  const value: SessionCtx = {
    app,
    base,
    api: client,
    me,
    loading,
    signIn: async (token) => {
      setToken(app, token);
      setLoading(true);
      await refresh();
    },
    signOut: async (all = false) => {
      try {
        await client.post(all ? '/auth/logout-all' : '/auth/logout');
      } catch {
        /* a sessão é apagada localmente de qualquer forma */
      }
      setToken(app, null);
      setMe(null);
    },
    refresh,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const c = useContext(Ctx);
  if (!c) throw new Error('SessionProvider em falta');
  return c;
}

/** Protege rotas: sem sessão vai para o login da respectiva aplicação. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const s = useSession();
  const loc = useLocation();
  if (s.loading) return <Loading />;
  if (!s.me) {
    // Na raiz da app Cliente, quem não tem sessão vê primeiro as boas-vindas.
    const atRoot = loc.pathname.replace(/\/$/, '') === s.base;
    const target = atRoot && s.app !== 'admin' ? 'boas-vindas' : 'entrar';
    return <Navigate to={`${s.base}/${target}`} replace state={{ from: atRoot ? undefined : loc.pathname }} />;
  }
  return <>{children}</>;
}
