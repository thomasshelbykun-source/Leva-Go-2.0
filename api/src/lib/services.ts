import type { Db, Stmt } from './db';
import { all, ApiError, forbidden, getSetting, nowIso, one, parseJson, run, uuid, type AppName, type AuthUser, type Ctx, type Env, type Role } from './core';
import { randomToken, sha256 } from './crypto';
import { canTransition, courierEarning, STATUS_LABELS, type Actor, type HoursRow, type OrderStatus, type Zone } from './domain';

// ------------------------------------------------------------------ Sessões
const SESSION_DAYS: Record<AppName, number> = { cliente: 60, estafeta: 30, admin: 1 };

export async function createSession(db: Db, userId: string, app: AppName) {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS[app] * 86_400_000).toISOString();
  await run(db, 'INSERT INTO sessions (id, user_id, token_hash, app, expires_at) VALUES (?,?,?,?,?)', uuid(), userId, await sha256(token), app, expires);
  return { token, expires_at: expires };
}

export async function loadSession(db: Db, token: string): Promise<AuthUser | null> {
  const row = await one<{ sid: string; app: AppName; id: string; name: string; phone: string; status: string }>(
    db,
    `SELECT s.id AS sid, s.app, u.id, u.name, u.phone, u.status
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
    await sha256(token),
    nowIso(),
  );
  if (!row || row.status !== 'active') return null;
  const roles = (await all<{ role: Role }>(db, 'SELECT role FROM user_roles WHERE user_id = ?', row.id)).map((r) => r.role);
  return { id: row.id, name: row.name, phone: row.phone, roles, app: row.app, sessionId: row.sid };
}

export function requireRole(c: Ctx, ...roles: Role[]): AuthUser {
  const u = c.get('user');
  if (!u) throw new ApiError(401, 'sessao_invalida', 'Inicie sessão para continuar.');
  if (!roles.some((r) => u.roles.includes(r))) throw forbidden();
  return u;
}

export const isAdmin = (u: AuthUser) => u.roles.includes('admin') || u.roles.includes('super_admin');

// ------------------------------------------------------------------ Limites de tentativas
export async function rateLimit(db: Db, key: string, max: number, windowMinutes: number) {
  const ms = windowMinutes * 60_000;
  const window = new Date(Math.floor(Date.now() / ms) * ms).toISOString();
  const r = await one<{ hits: number }>(
    db,
    `INSERT INTO rate_limits (key, bucket, hits) VALUES (?, ?, 1)
     ON CONFLICT(key, bucket) DO UPDATE SET hits = rate_limits.hits + 1 RETURNING hits`,
    key,
    window,
  );
  if ((r?.hits ?? 0) > max) throw new ApiError(429, 'demasiadas_tentativas', 'Demasiadas tentativas. Aguarde alguns minutos.');
}

// ------------------------------------------------------------------ Auditoria
export function auditStmt(db: Db, actor: { id: string | null; role: string }, action: string, entity: string, entityId: string | null, reason?: string | null, before?: unknown, after?: unknown) {
  return db
    .prepare('INSERT INTO audit_logs (id, actor_id, actor_role, action, entity, entity_id, reason, before_json, after_json) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(uuid(), actor.id, actor.role, action, entity, entityId, reason ?? null, before === undefined ? null : JSON.stringify(before), after === undefined ? null : JSON.stringify(after));
}

export const actorRole = (u: AuthUser) => (u.roles.includes('super_admin') ? 'super_admin' : u.roles.includes('admin') ? 'admin' : u.app === 'estafeta' ? 'courier' : 'customer');

// ------------------------------------------------------------------ Notificações
export function notifyStmt(db: Db, userId: string, eventId: string, category: string, title: string, body: string, orderId?: string | null) {
  return db
    .prepare('INSERT INTO notifications (id, user_id, event_id, category, title, body, order_id) VALUES (?,?,?,?,?,?,?) ON CONFLICT DO NOTHING')
    .bind(uuid(), userId, eventId, category, title, body, orderId ?? null);
}

// ------------------------------------------------------------------ Dados de referência
export async function loadZones(db: Db): Promise<Zone[]> {
  const rows = await all<{ id: string; name: string; kind: Zone['kind']; polygon: string }>(db, 'SELECT id, name, kind, polygon FROM service_zones WHERE active = 1');
  return rows.map((r) => ({ ...r, polygon: parseJson(r.polygon, []) }));
}

export const loadHours = (db: Db) => all<HoursRow>(db, 'SELECT weekday, opens_at, closes_at FROM business_hours ORDER BY weekday, opens_at');

// ------------------------------------------------------------------ Transições de estado
export interface OrderRow {
  id: string;
  code: string;
  customer_id: string;
  status: OrderStatus;
  assigned_courier_id: string | null;
  price_cents: number;
  payment_method: string;
  payment_status: string;
  weight_kg: number;
  [k: string]: unknown;
}

const NOTIFY_CUSTOMER: Partial<Record<OrderStatus, string>> = {
  PENDENTE_ATRIBUICAO: 'Pedido confirmado. Estamos à procura de um estafeta.',
  ACEITE: 'Um estafeta aceitou o seu pedido e vai à recolha.',
  RECOLHIDO: 'A sua encomenda foi recolhida.',
  EM_TRANSPORTE: 'A sua encomenda está a caminho do destino.',
  ENTREGUE: 'A sua encomenda foi entregue.',
  CANCELADO: 'O seu pedido foi cancelado.',
  FALHA_ENTREGA: 'Houve um problema na entrega. A equipa LevaGo vai contactar.',
  DEVOLVIDO: 'A encomenda foi devolvida ao ponto de recolha.',
};

/**
 * Muda o estado de forma atómica: a actualização só acontece se o estado actual for o esperado,
 * e o evento de auditoria e as notificações são gravados na mesma transacção.
 * Devolve false se outra pessoa mudou o pedido primeiro.
 */
export async function transition(
  db: Db,
  order: OrderRow,
  to: OrderStatus,
  actor: { id: string | null; role: Actor },
  opts: { note?: string; set?: Record<string, unknown>; extra?: Stmt[]; requireCourier?: string | null } = {},
): Promise<boolean> {
  if (!canTransition(order.status, to, actor.role)) {
    throw new ApiError(409, 'transicao_invalida', `Não é possível passar de "${STATUS_LABELS[order.status]}" para "${STATUS_LABELS[to]}".`);
  }
  const set: Record<string, unknown> = { ...(opts.set ?? {}), status: to, updated_at: nowIso() };
  const cols = Object.keys(set);
  const where = ['id = ?', 'status = ?'];
  const whereParams: unknown[] = [order.id, order.status];
  if (opts.requireCourier !== undefined) {
    where.push(opts.requireCourier === null ? 'assigned_courier_id IS NULL' : 'assigned_courier_id = ?');
    if (opts.requireCourier !== null) whereParams.push(opts.requireCourier);
  }
  const upd = db.prepare(`UPDATE orders SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE ${where.join(' AND ')}`).bind(...cols.map((k) => set[k]), ...whereParams);
  const follow: Stmt[] = [
    db.prepare('INSERT INTO order_events (id, order_id, from_status, to_status, actor_id, actor_role, note) VALUES (?,?,?,?,?,?,?)').bind(uuid(), order.id, order.status, to, actor.id, actor.role, opts.note ?? null),
    ...(opts.extra ?? []),
  ];
  const msg = NOTIFY_CUSTOMER[to];
  if (msg) follow.push(notifyStmt(db, order.customer_id, `order:${order.id}:${to}`, 'encomenda', `${order.code}: ${STATUS_LABELS[to]}`, msg, order.id));
  return guardedBatch(db, upd, follow);
}

/**
 * Executa `first` e o resto num só lote (transacção). Se `first` não mudar exactamente 1 linha,
 * nada é gravado e devolve false. É assim que se garante que dois estafetas não aceitam o mesmo pedido.
 */
export async function guardedBatch(db: Db, first: Stmt, rest: Stmt[]): Promise<boolean> {
  return db.guarded(first, rest);
}

/** Créditos ao estafeta quando a entrega é concluída (idempotente pela chave única do livro). */
export async function earningStmt(db: Db, courierId: string, order: OrderRow) {
  const prof = await one<{ link_type: 'proprio' | 'independente' }>(db, 'SELECT link_type FROM courier_profiles WHERE user_id = ?', courierId);
  const cfg = await getSetting(db, 'courier_pay', { independent_share_bps: 7000, own_per_delivery_cents: 0 });
  const amount = courierEarning(prof?.link_type ?? 'independente', order.price_cents, cfg);
  return db
    .prepare("INSERT INTO earnings_ledger (id, courier_id, order_id, kind, amount_cents, note) VALUES (?,?,?,'entrega',?,?) ON CONFLICT DO NOTHING")
    .bind(uuid(), courierId, order.id, amount, prof?.link_type === 'proprio' ? 'Estafeta próprio: remuneração por contrato' : 'Entrega concluída');
}

export function envFlags(env: Env) {
  return { environment: env.ENVIRONMENT, demo: env.ENVIRONMENT !== 'production' };
}
