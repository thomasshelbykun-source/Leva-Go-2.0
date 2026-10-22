// Cliente HTTP da API LevaGo. Cada aplicação (cliente, estafeta, admin) tem a sua própria sessão.
export type AppName = 'cliente' | 'estafeta' | 'admin';

export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? 'http://localhost:8787';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: Record<string, string> | null) {
    super(message);
  }
}

const tokenKey = (app: AppName) => `levago.${app}.token`;

export function getToken(app: AppName): string | null {
  try {
    return localStorage.getItem(tokenKey(app));
  } catch {
    return null;
  }
}

export function setToken(app: AppName, token: string | null) {
  try {
    if (token) localStorage.setItem(tokenKey(app), token);
    else localStorage.removeItem(tokenKey(app));
  } catch {
    /* armazenamento indisponível: a sessão dura só esta página */
  }
  window.dispatchEvent(new CustomEvent('levago:session', { detail: app }));
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
    try {
      res = await fetch(`${API_URL}/v1${path}`, {
        method,
        headers,
        body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      });
    } catch {
      throw new ApiError(0, 'sem_rede', 'Sem ligação. Verifique a internet e tente de novo.');
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
      throw new ApiError(res.status, data?.error ?? 'erro', data?.message ?? 'Ocorreu um erro. Tente de novo.', data?.details ?? null);
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
