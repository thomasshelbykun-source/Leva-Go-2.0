// Cliente HTTP da API LevaGo. Cada aplicação (cliente, estafeta, admin) tem a sua própria sessão.
export type AppName = 'cliente' | 'estafeta' | 'admin';

// Endereço da API. Sem VITE_API_URL, o site publicado usa a API no mesmo endereço (/v1, pasta functions/).
export const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? (import.meta.env.DEV ? 'http://localhost:8787' : '');

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: Record<string, string> | null) {
    super(message);
  }
}

const tokenKey = (app: AppName) => `levago.${app}.token`;

export function getToken(app: AppName): string | null {
  try {
    // «Manter sessão iniciada» guarda no aparelho; sem a opção, só até fechar o navegador.
    return localStorage.getItem(tokenKey(app)) ?? sessionStorage.getItem(tokenKey(app));
  } catch {
    return null;
  }
}

export function setToken(app: AppName, token: string | null, remember = true) {
  try {
    localStorage.removeItem(tokenKey(app));
    sessionStorage.removeItem(tokenKey(app));
    if (token) (remember ? localStorage : sessionStorage).setItem(tokenKey(app), token);
    if (!token) forgetPlace(app);
  } catch {
    /* armazenamento indisponível: a sessão dura só esta página */
  }
  window.dispatchEvent(new CustomEvent('levago:session', { detail: app }));
}

// ------------------------------------------------------------------ Última página
// Quem sai da app sem querer volta à mesma página ao abrir o site outra vez.
const PLACE_KEY = 'levago.ultima-pagina';
const NOT_PLACES = /\/(entrar|registo|boas-vindas|recuperar)(\/|$)/;

export function appOfPath(path: string): AppName | null {
  const m = path.match(/^\/(cliente|estafeta|admin)(\/|$)/);
  return (m?.[1] as AppName | undefined) ?? null;
}

export function rememberPlace(path: string) {
  if (!appOfPath(path) || NOT_PLACES.test(path)) return;
  try {
    localStorage.setItem(PLACE_KEY, path);
  } catch {
    /* sem armazenamento */
  }
}

export function lastPlace(): string | null {
  try {
    return localStorage.getItem(PLACE_KEY);
  } catch {
    return null;
  }
}

function forgetPlace(app: AppName) {
  const last = lastPlace();
  if (last && appOfPath(last) === app) localStorage.removeItem(PLACE_KEY);
}

export function newIdempotencyKey() {
  return crypto.randomUUID();
}

interface Opts {
  body?: unknown;
  form?: FormData;
  idem?: string;
  raw?: boolean;
}

export function api(app: AppName) {
  async function request<T = any>(method: string, path: string, opts: Opts = {}): Promise<T> {
    const headers: Record<string, string> = {};
    const token = getToken(app);
    if (token) headers.Authorization = `Bearer ${token}`;
    if (opts.idem) headers['Idempotency-Key'] = opts.idem;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    let res: Response;
    // Sem resposta em 25 s (60 s para ficheiros), o pedido é cancelado: o ecrã nunca fica preso.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.form ? 60_000 : 25_000);
    try {
      res = await fetch(`${API_URL}/v1${path}`, {
        method,
        headers,
        body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
        signal: ctrl.signal,
      });
    } catch {
      throw new ApiError(0, 'sem_rede', 'Sem ligação. Verifique a internet e tente de novo.');
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401 && token) setToken(app, null);
    if (opts.raw && res.ok) return res as unknown as T;
    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      // Erros do servidor levam o código, para se saber de onde vêm (500 = API; 502/503/1102 = Cloudflare sem resposta da API).
      const cf = typeof data === 'string' ? data.match(/error code:? *(\d{4})/i)?.[1] : undefined;
      const ref = res.status >= 500 ? ` (código ${cf ?? res.status}${data?.ref ? ` · ${data.ref}` : ''})` : '';
      throw new ApiError(res.status, data?.error ?? 'erro', (data?.message ?? 'Ocorreu um erro. Tente de novo.') + ref, data?.details ?? null);
    }
    return data as T;
  }
  return {
    get: <T = any>(p: string) => request<T>('GET', p),
    post: <T = any>(p: string, body?: unknown, idem?: string) => request<T>('POST', p, { body: body ?? {}, idem }),
    put: <T = any>(p: string, body: unknown) => request<T>('PUT', p, { body }),
    patch: <T = any>(p: string, body: unknown) => request<T>('PATCH', p, { body }),
    del: <T = any>(p: string) => request<T>('DELETE', p),
    upload: <T = any>(p: string, form: FormData) => request<T>('POST', p, { form }),
    raw: (p: string) => request<Response>('GET', p, { raw: true }),
  };
}

export type Api = ReturnType<typeof api>;
