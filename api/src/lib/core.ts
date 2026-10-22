import type { Db } from './db';
import type { Context } from 'hono';

export type Role = 'customer' | 'courier' | 'admin' | 'super_admin';
export type AppName = 'cliente' | 'estafeta' | 'admin';

export interface Env {
  DB: Db;
  CRON_SECRET?: string;
  ENVIRONMENT: string; // dev | test | staging | production
  CORS_ORIGINS: string;
  ROUTING_OSRM_URL?: string;
  GEOCODER_URL?: string;
  PAYMENTS_WEBHOOK_SECRET?: string;
  SMS_PROVIDER_URL?: string;
  SMS_PROVIDER_KEY?: string;
}

export interface AuthUser {
  id: string;
  name: string;
  phone: string;
  roles: Role[];
  app: AppName;
  sessionId: string;
}

export type Vars = { user: AuthUser };
export type Ctx = Context<{ Bindings: Env; Variables: Vars }>;

/** Erro de domínio devolvido ao cliente com código estável e mensagem em português. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const bad = (code: string, message: string, details?: unknown) => new ApiError(400, code, message, details);
export const forbidden = (message = 'Sem permissão para esta acção.') => new ApiError(403, 'sem_permissao', message);
export const notFound = (message = 'Não encontrado.') => new ApiError(404, 'nao_encontrado', message);
export const conflict = (code: string, message: string) => new ApiError(409, code, message);

export const uuid = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();
export const addMinutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

export async function one<T = Record<string, unknown>>(db: Db, sql: string, ...params: unknown[]): Promise<T | null> {
  return (await db.prepare(sql).bind(...params).first<T>()) ?? null;
}

export async function all<T = Record<string, unknown>>(db: Db, sql: string, ...params: unknown[]): Promise<T[]> {
  const r = await db.prepare(sql).bind(...params).all<T>();
  return r.results ?? [];
}

export async function run(db: Db, sql: string, ...params: unknown[]) {
  return db.prepare(sql).bind(...params).run();
}

export function parseJson<T>(s: unknown, fallback: T): T {
  if (typeof s !== 'string') return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export async function getSetting<T>(db: Db, key: string, fallback: T): Promise<T> {
  const row = await one<{ value: string }>(db, 'SELECT value FROM system_settings WHERE key = ?', key);
  return row ? { ...fallback, ...parseJson<T>(row.value, fallback) } : fallback;
}

/** Validação simples de corpo de pedido. Lança 400 com a lista de campos inválidos. */
export function need<T extends object>(body: unknown, rules: { [K in keyof T]: (v: unknown) => string | null }): T {
  if (!body || typeof body !== 'object') throw bad('corpo_invalido', 'Pedido sem dados.');
  const errors: Record<string, string> = {};
  const out: Record<string, unknown> = {};
  for (const [k, check] of Object.entries(rules) as [string, (x: unknown) => string | null][]) {
    const v = (body as Record<string, unknown>)[k];
    const e = check(v);
    if (e) errors[k] = e;
    else out[k] = typeof v === 'string' ? v.trim() : v;
  }
  if (Object.keys(errors).length) throw bad('validacao', 'Verifique os campos assinalados.', errors);
  return out as T;
}

export const v = {
  str: (min = 1, max = 500) => (x: unknown) =>
    typeof x === 'string' && x.trim().length >= min && x.trim().length <= max ? null : `Texto entre ${min} e ${max} caracteres.`,
  optStr: (max = 500) => (x: unknown) =>
    x === undefined || x === null || (typeof x === 'string' && x.length <= max) ? null : `Máximo ${max} caracteres.`,
  num: (min: number, max: number) => (x: unknown) =>
    typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max ? null : `Número entre ${min} e ${max}.`,
  int: (min: number, max: number) => (x: unknown) =>
    typeof x === 'number' && Number.isInteger(x) && x >= min && x <= max ? null : `Inteiro entre ${min} e ${max}.`,
  oneOf: (...opts: string[]) => (x: unknown) => (typeof x === 'string' && opts.includes(x) ? null : `Valor inválido.`),
  bool: () => (x: unknown) => (typeof x === 'boolean' ? null : 'Verdadeiro ou falso.'),
  optBool: () => (x: unknown) => (x === undefined || typeof x === 'boolean' ? null : 'Verdadeiro ou falso.'),
  any: () => () => null,
  phone: () => (x: unknown) => (typeof x === 'string' && normalizePhone(x) ? null : 'Número de telemóvel de Moçambique inválido.'),
  lat: () => (x: unknown) => (typeof x === 'number' && x >= -90 && x <= 90 ? null : 'Latitude inválida.'),
  lon: () => (x: unknown) => (typeof x === 'number' && x >= -180 && x <= 180 ? null : 'Longitude inválida.'),
};

/** Normaliza para +258 8X XXX XXXX. Aceita 84..., 25884..., +25884... */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, '');
  let local = digits;
  if (local.startsWith('258') && local.length === 12) local = local.slice(3);
  if (!/^8[2-7]\d{7}$/.test(local)) return null;
  return `+258${local}`;
}

export function maskPhone(phone: string): string {
  return phone.length > 6 ? `${phone.slice(0, 6)}***${phone.slice(-2)}` : '***';
}

/** Ficheiros privados guardados na base de dados (tabela file_blobs). */
export const MAX_FILE_BYTES = 4 * 1024 * 1024; // a Vercel aceita pedidos até 4,5 MB

export function files(env: Env) {
  return {
    async put(key: string, data: ArrayBuffer, contentType: string) {
      if (data.byteLength > MAX_FILE_BYTES) throw bad('ficheiro', 'O ficheiro tem mais de 4 MB.');
      await run(env.DB, 'INSERT INTO file_blobs (key, content_type, size_bytes, data) VALUES (?,?,?,?)', key, contentType, data.byteLength, Buffer.from(data));
    },
    async get(key: string) {
      const row = await one<{ content_type: string; data: Buffer }>(env.DB, 'SELECT content_type, data FROM file_blobs WHERE key = ?', key);
      return row ? { body: new Uint8Array(row.data), contentType: row.content_type } : null;
    },
  };
}

export function isProd(env: Env) {
  return env.ENVIRONMENT === 'production';
}
