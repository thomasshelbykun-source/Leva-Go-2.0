import type { Stmt } from '../lib/db.js';
import { Hono } from 'hono';
import { roadRoute } from '../lib/adapters.js';
import { all, bad, conflict, files, forbidden, getSetting, need, normalizePhone, notFound, nowIso, one, parseJson, run, uuid, v, type AuthUser, type Ctx, type Env, type Vars } from '../lib/core.js';
import { checkRoadDistance, pointInPolygon, priceFor, STATUS_LABELS, vehicleCanCarry, type LonLat, type OrderStatus, type PricingRule } from '../lib/domain.js';
import { actorRole, auditStmt, notifyStmt, requireRole, transition, type OrderRow } from '../lib/services.js';

const r = new Hono<{ Bindings: Env; Variables: Vars }>();

function admin(c: Ctx): AuthUser {
  const u = requireRole(c, 'admin', 'super_admin');
  if (u.app !== 'admin') throw forbidden('Use o painel administrativo.');
  return u;
}
const who = (u: AuthUser) => ({ id: u.id, role: actorRole(u) });
const reasonRule = { reason: v.str(3, 500) };

const csv = (rows: Record<string, unknown>[]) => {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]!);
  const esc = (x: unknown) => {
    const s = x === null || x === undefined ? '' : String(x);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((k) => esc(r[k])).join(','))].join('\n');
};
const maskPhone = (p: string) => (p ? `${p.slice(0, 7)}•••${p.slice(-2)}` : '');

// ------------------------------------------------------------------ 02 Dashboard
r.get('/dashboard', async (c) => {
  admin(c);
  const from = c.req.query('from') ?? new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const to = c.req.query('to') ?? new Date().toISOString().slice(0, 10);
  const range = [`${from}T00:00:00.000Z`, `${to}T23:59:59.999Z`];
  const db = c.env.DB;
  const [orders, byStatus, revenue, couriers, series, alerts] = await Promise.all([
    one<{ total: number; delivered: number; cancelled: number }>(
      db,
      `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'ENTREGUE' THEN 1 ELSE 0 END) AS delivered, SUM(CASE WHEN status = 'CANCELADO' THEN 1 ELSE 0 END) AS cancelled FROM orders WHERE created_at BETWEEN ? AND ?`,
      ...range,
    ),
    all(db, 'SELECT status, COUNT(*) AS n FROM orders WHERE created_at BETWEEN ? AND ? GROUP BY status', ...range),
    one<{ paid: number; refunded: number }>(
      db,
      `SELECT COALESCE(SUM(CASE WHEN status = 'succeeded' THEN amount_cents END),0) AS paid, COALESCE(SUM(CASE WHEN status = 'refunded' THEN amount_cents END),0) AS refunded
         FROM payment_intents WHERE created_at BETWEEN ? AND ?`,
      ...range,
    ),
    one<{ active: number; online: number; pending: number }>(
      db,
      `SELECT SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active, SUM(CASE WHEN status = 'active' AND is_online = 1 THEN 1 ELSE 0 END) AS online, (SELECT COUNT(*) FROM courier_applications WHERE status = 'pending') AS pending FROM courier_profiles`,
    ),
    all(
      db,
      `SELECT to_char(created_at::timestamptz AT TIME ZONE 'Africa/Maputo', 'YYYY-MM-DD') AS day, COUNT(*) AS orders, SUM(CASE WHEN status = 'ENTREGUE' THEN 1 ELSE 0 END) AS delivered, COALESCE(SUM(CASE WHEN payment_status IN ('succeeded') THEN price_cents END),0) AS revenue_cents
         FROM orders WHERE created_at BETWEEN ? AND ? GROUP BY day ORDER BY day`,
      ...range,
    ),
    Promise.all([
      one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM orders WHERE status = 'PENDENTE_ATRIBUICAO' AND (scheduled_at IS NULL OR scheduled_at <= ?) AND created_at < ?", nowIso(), new Date(Date.now() - 15 * 60_000).toISOString()),
      one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM orders WHERE status = 'FALHA_ENTREGA'"),
      one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM refunds WHERE status = 'requested'"),
      one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM support_tickets WHERE status IN ('aberto','em_curso') AND sla_due_at < ?", nowIso()),
      one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM pricing_versions WHERE status = 'published'"),
    ]),
  ]);
  const [waiting, failed, refunds, slaLate, pricing] = alerts;
  const list: { level: string; text: string; link: string }[] = [];
  if (waiting?.n) list.push({ level: 'warning', text: `${waiting.n} pedido(s) há mais de 15 min sem estafeta`, link: '/admin/encomendas?status=PENDENTE_ATRIBUICAO' });
  if (failed?.n) list.push({ level: 'critical', text: `${failed.n} entrega(s) com falha por resolver`, link: '/admin/encomendas?status=FALHA_ENTREGA' });
  if (refunds?.n) list.push({ level: 'warning', text: `${refunds.n} reembolso(s) à espera de aprovação`, link: '/admin/pagamentos' });
  if (slaLate?.n) list.push({ level: 'warning', text: `${slaLate.n} caso(s) de apoio fora do prazo`, link: '/admin/suporte' });
  if (!pricing?.n) list.push({ level: 'critical', text: 'Sem tabela de preços publicada: não é possível cotar.', link: '/admin/tarifas' });
  if (couriers?.pending) list.push({ level: 'info', text: `${couriers.pending} candidatura(s) de estafeta por rever`, link: '/admin/estafetas' });
  return c.json({ from, to, orders, by_status: byStatus, revenue, couriers, series, alerts: list });
});

// ------------------------------------------------------------------ 03 Clientes
r.get('/customers', async (c) => {
  admin(c);
  const q = `%${(c.req.query('q') ?? '').trim()}%`;
  const status = c.req.query('status');
  const rows = await all<{ phone: string } & Record<string, unknown>>(
    c.env.DB,
    `SELECT u.id, u.name, u.phone, u.email, u.status, u.created_at,
            (SELECT COUNT(*) FROM orders o WHERE o.customer_id = u.id) AS orders
       FROM users u WHERE (u.name ILIKE ? OR u.phone ILIKE ?) ${status ? 'AND u.status = ?' : ''}
      ORDER BY u.created_at DESC LIMIT 100`,
    ...(status ? [q, q, status] : [q, q]),
  );
  return c.json(rows.map((x) => ({ ...x, phone: maskPhone(x.phone) })));
});

r.get('/customers/:id', async (c) => {
  const u = admin(c);
  const row = await one(c.env.DB, 'SELECT id, name, phone, email, status, created_at, phone_verified_at FROM users WHERE id = ?', c.req.param('id'));
  if (!row) throw notFound();
  // Ver dados completos fica registado.
  await c.env.DB.batch([auditStmt(c.env.DB, who(u), 'customer.view', 'user', c.req.param('id'))]);
  const roles = await all(c.env.DB, 'SELECT role FROM user_roles WHERE user_id = ?', c.req.param('id'));
  const orders = await all(c.env.DB, 'SELECT id, code, status, price_cents, created_at FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50', c.req.param('id'));
  const tickets = await all(c.env.DB, 'SELECT id, subject, status, created_at FROM support_tickets WHERE opened_by = ? ORDER BY created_at DESC', c.req.param('id'));
  const actions = await all(c.env.DB, "SELECT action, reason, actor_id, created_at FROM audit_logs WHERE entity = 'user' AND entity_id = ? AND action <> 'customer.view' ORDER BY created_at DESC", c.req.param('id'));
  return c.json({ ...row, roles: roles.map((x) => x.role), orders, tickets, actions });
});

r.post('/customers/:id/status', async (c) => {
  const u = admin(c);
  const b = need<{ status: 'active' | 'suspended'; reason: string }>(await c.req.json(), { status: v.oneOf('active', 'suspended'), ...reasonRule });
  if (c.req.param('id') === u.id) throw forbidden('Não pode alterar o estado da própria conta.');
  const before = await one<{ status: string }>(c.env.DB, 'SELECT status FROM users WHERE id = ?', c.req.param('id'));
  if (!before) throw notFound();
  const stmts = [
    c.env.DB.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?').bind(b.status, nowIso(), c.req.param('id')),
    auditStmt(c.env.DB, who(u), `user.${b.status}`, 'user', c.req.param('id'), b.reason, before, { status: b.status }),
  ];
  if (b.status === 'suspended') stmts.push(c.env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').bind(nowIso(), c.req.param('id')));
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ 04 Estafetas
r.get('/couriers', async (c) => {
  admin(c);
  const apps = await all(
    c.env.DB,
    `SELECT a.id, a.user_id, a.link_type, a.status, a.created_at, u.name, u.phone
       FROM courier_applications a JOIN users u ON u.id = a.user_id ORDER BY a.status = 'pending' DESC, a.created_at DESC LIMIT 100`,
  );
  const couriers = await all(
    c.env.DB,
    `SELECT p.user_id, u.name, u.phone, p.link_type, p.status, p.is_online, p.rating_avg, p.rating_count, p.zone_id,
            (SELECT COUNT(*) FROM orders o WHERE o.assigned_courier_id = p.user_id AND o.status = 'ENTREGUE') AS delivered,
            (SELECT kind || ' ' || capacity_kg || ' kg' FROM vehicles WHERE courier_id = p.user_id AND status = 'approved' LIMIT 1) AS vehicle
       FROM courier_profiles p JOIN users u ON u.id = p.user_id ORDER BY u.name`,
  );
  return c.json({ applications: apps.map((a) => ({ ...a, phone: maskPhone(String(a.phone)) })), couriers: couriers.map((x) => ({ ...x, phone: maskPhone(String(x.phone)) })) });
});

r.get('/couriers/:userId', async (c) => {
  const u = admin(c);
  const id = c.req.param('userId');
  const user = await one(c.env.DB, 'SELECT id, name, phone, email, status FROM users WHERE id = ?', id);
  if (!user) throw notFound();
  await c.env.DB.batch([auditStmt(c.env.DB, who(u), 'courier.view', 'user', id)]);
  return c.json({
    user,
    profile: await one(c.env.DB, 'SELECT * FROM courier_profiles WHERE user_id = ?', id),
    applications: await all(c.env.DB, 'SELECT * FROM courier_applications WHERE user_id = ? ORDER BY created_at DESC', id),
    vehicles: await all(c.env.DB, 'SELECT * FROM vehicles WHERE courier_id = ? ORDER BY created_at', id),
    documents: await all(c.env.DB, 'SELECT id, kind, status, vehicle_id, content_type, created_at FROM courier_documents WHERE courier_id = ? ORDER BY created_at', id),
    orders: await all(c.env.DB, 'SELECT id, code, status, updated_at FROM orders WHERE assigned_courier_id = ? ORDER BY updated_at DESC LIMIT 30', id),
    disputes: await all(c.env.DB, 'SELECT d.*, l.amount_cents FROM earning_disputes d JOIN earnings_ledger l ON l.id = d.ledger_id WHERE d.courier_id = ? ORDER BY d.created_at DESC', id),
  });
});

/** Ficheiro privado, servido só a administradores e com registo de acesso. */
r.get('/documents/:id/file', async (c) => {
  const u = admin(c);
  const d = await one<{ r2_key: string; content_type: string }>(c.env.DB, 'SELECT r2_key, content_type FROM courier_documents WHERE id = ?', c.req.param('id'));
  if (!d) throw notFound();
  const obj = await files(c.env).get(d.r2_key);
  if (!obj) throw notFound('Ficheiro em falta.');
  await c.env.DB.batch([auditStmt(c.env.DB, who(u), 'document.view', 'courier_document', c.req.param('id'))]);
  return new Response(obj.body, { headers: { 'content-type': d.content_type, 'cache-control': 'private, no-store' } });
});

r.post('/documents/:id/review', async (c) => {
  const u = admin(c);
  const b = need<{ status: 'approved' | 'rejected'; reason: string }>(await c.req.json(), { status: v.oneOf('approved', 'rejected'), ...reasonRule });
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE courier_documents SET status = ? WHERE id = ?').bind(b.status, c.req.param('id')),
    auditStmt(c.env.DB, who(u), `document.${b.status}`, 'courier_document', c.req.param('id'), b.reason),
  ]);
  return c.json({ ok: true });
});

/** Aprovação humana da candidatura. Quem se candidata não se pode aprovar a si próprio. */
r.post('/applications/:id/review', async (c) => {
  const u = admin(c);
  const b = need<{ decision: 'approved' | 'rejected'; reason: string; zone_id?: string }>(await c.req.json(), { decision: v.oneOf('approved', 'rejected'), ...reasonRule, zone_id: v.optStr(64) });
  const app = await one<{ id: string; user_id: string; status: string; link_type: string }>(c.env.DB, 'SELECT * FROM courier_applications WHERE id = ?', c.req.param('id'));
  if (!app) throw notFound();
  if (app.user_id === u.id) throw forbidden('Não pode rever a sua própria candidatura.');
  if (app.status !== 'pending') throw conflict('ja_revista', 'Esta candidatura já foi revista.');
  const now = nowIso();
  const stmts = [
    c.env.DB.prepare('UPDATE courier_applications SET status = ?, reviewer_id = ?, review_note = ?, reviewed_at = ? WHERE id = ?').bind(b.decision, u.id, b.reason, now, app.id),
    auditStmt(c.env.DB, who(u), `courier_application.${b.decision}`, 'courier_application', app.id, b.reason),
  ];
  if (b.decision === 'approved') {
    stmts.push(
      c.env.DB.prepare("UPDATE courier_profiles SET status = 'active', approved_at = ?, zone_id = COALESCE(?, zone_id), updated_at = ? WHERE user_id = ?").bind(now, b.zone_id ?? null, now, app.user_id),
      c.env.DB.prepare("INSERT INTO user_roles (user_id, role, granted_by) VALUES (?, 'courier', ?) ON CONFLICT DO NOTHING").bind(app.user_id, u.id),
      notifyStmt(c.env.DB, app.user_id, `courier_app:${app.id}:approved`, 'conta', 'Candidatura aprovada', 'Bem-vindo à LevaGo! Confirme que o veículo está aprovado e fique online.'),
    );
  } else {
    stmts.push(notifyStmt(c.env.DB, app.user_id, `courier_app:${app.id}:rejected`, 'conta', 'Candidatura não aprovada', `Motivo: ${b.reason}`));
  }
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

r.post('/vehicles/:id/review', async (c) => {
  const u = admin(c);
  const b = need<{ status: 'approved' | 'rejected'; reason: string; capacity_kg?: number }>(await c.req.json(), { status: v.oneOf('approved', 'rejected'), ...reasonRule, capacity_kg: (x) => (x === undefined || (typeof x === 'number' && x > 0 && x <= 15) ? null : 'Capacidade entre 0 e 15 kg.') });
  const veh = await one<{ courier_id: string; capacity_kg: number }>(c.env.DB, 'SELECT * FROM vehicles WHERE id = ?', c.req.param('id'));
  if (!veh) throw notFound();
  if (veh.courier_id === u.id) throw forbidden('Não pode aprovar o seu próprio veículo.');
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE vehicles SET status = ?, review_note = ?, capacity_kg = ?, updated_at = ? WHERE id = ?').bind(b.status, b.reason, b.capacity_kg ?? veh.capacity_kg, nowIso(), c.req.param('id')),
    auditStmt(c.env.DB, who(u), `vehicle.${b.status}`, 'vehicle', c.req.param('id'), b.reason, veh, b),
    notifyStmt(c.env.DB, veh.courier_id, `vehicle:${c.req.param('id')}:${b.status}:${Date.now()}`, 'conta', b.status === 'approved' ? 'Veículo aprovado' : 'Veículo rejeitado', b.reason),
  ]);
  return c.json({ ok: true });
});

r.post('/couriers/:userId/status', async (c) => {
  const u = admin(c);
  const b = need<{ status: 'active' | 'suspended'; reason: string; zone_id?: string }>(await c.req.json(), { status: v.oneOf('active', 'suspended'), ...reasonRule, zone_id: v.optStr(64) });
  const id = c.req.param('userId');
  if (id === u.id) throw forbidden();
  const prof = await one<{ status: string }>(c.env.DB, 'SELECT status FROM courier_profiles WHERE user_id = ?', id);
  if (!prof) throw notFound();
  if (b.status === 'active' && !(await one(c.env.DB, "SELECT 1 FROM courier_applications WHERE user_id = ? AND status = 'approved'", id))) throw conflict('sem_aprovacao', 'Sem candidatura aprovada não pode ficar activo.');
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE courier_profiles SET status = ?, is_online = CASE WHEN ? = \'suspended\' THEN 0 ELSE is_online END, zone_id = COALESCE(?, zone_id), updated_at = ? WHERE user_id = ?').bind(b.status, b.status, b.zone_id ?? null, nowIso(), id),
    auditStmt(c.env.DB, who(u), `courier.${b.status}`, 'user', id, b.reason, prof, { status: b.status }),
  ]);
  return c.json({ ok: true });
});

r.post('/disputes/:id/resolve', async (c) => {
  const u = admin(c);
  const b = need<{ adjustment_cents: number; reason: string }>(await c.req.json(), { adjustment_cents: v.int(-1e7, 1e7), ...reasonRule });
  const d = await one<{ id: string; courier_id: string; ledger_id: string; status: string }>(c.env.DB, 'SELECT * FROM earning_disputes WHERE id = ?', c.req.param('id'));
  if (!d || d.status !== 'open') throw notFound();
  const stmts = [
    c.env.DB.prepare("UPDATE earning_disputes SET status = 'resolved' WHERE id = ?").bind(d.id),
    auditStmt(c.env.DB, who(u), 'earning_dispute.resolve', 'earning_dispute', d.id, b.reason, null, { adjustment_cents: b.adjustment_cents }),
    notifyStmt(c.env.DB, d.courier_id, `dispute:${d.id}`, 'ganhos', 'Contestação resolvida', b.reason),
  ];
  if (b.adjustment_cents) stmts.push(c.env.DB.prepare("INSERT INTO earnings_ledger (id, courier_id, order_id, kind, amount_cents, note) VALUES (?,?,NULL,'ajuste',?,?)").bind(uuid(), d.courier_id, b.adjustment_cents, b.reason));
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

r.post('/payouts', async (c) => {
  const u = admin(c);
  const b = need<{ courier_id: string; reference: string }>(await c.req.json(), { courier_id: v.str(10, 64), reference: v.str(3, 100) });
  const sum = await one<{ s: number }>(c.env.DB, 'SELECT COALESCE(SUM(amount_cents),0) AS s FROM earnings_ledger WHERE courier_id = ? AND payout_id IS NULL', b.courier_id);
  if (!sum?.s || sum.s <= 0) throw bad('sem_saldo', 'Sem saldo por liquidar.');
  const id = uuid();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO payouts (id, courier_id, amount_cents, status, reference, created_by, paid_at) VALUES (?,?,?, 'paid', ?, ?, ?)").bind(id, b.courier_id, sum.s, b.reference, u.id, nowIso()),
    c.env.DB.prepare('UPDATE earnings_ledger SET payout_id = ? WHERE courier_id = ? AND payout_id IS NULL').bind(id, b.courier_id),
    auditStmt(c.env.DB, who(u), 'payout.create', 'payout', id, b.reference, null, { amount_cents: sum.s }),
    notifyStmt(c.env.DB, b.courier_id, `payout:${id}`, 'ganhos', 'Liquidação registada', `Foram liquidados ${(sum.s / 100).toFixed(2)} MT. Ref.: ${b.reference}`),
  ]);
  return c.json({ id, amount_cents: sum.s }, 201);
});

// ------------------------------------------------------------------ 05 Encomendas
const ORDER_LIST_SQL = `SELECT o.id, o.code, o.status, o.service_type, o.weight_kg, o.road_distance_m, o.price_cents, o.payment_method, o.payment_status,
        o.created_at, o.updated_at, o.scheduled_at, cu.name AS customer, co.name AS courier, o.pickup_snapshot, o.dropoff_snapshot
   FROM orders o JOIN users cu ON cu.id = o.customer_id LEFT JOIN users co ON co.id = o.assigned_courier_id`;

function orderFilters(c: Ctx) {
  const where: string[] = [];
  const p: unknown[] = [];
  const status = c.req.query('status');
  if (status) { where.push('o.status = ?'); p.push(status); }
  const q = c.req.query('q');
  if (q) { where.push('(o.code ILIKE ? OR cu.name ILIKE ?)'); p.push(`%${q}%`, `%${q}%`); }
  const from = c.req.query('from');
  if (from) { where.push('o.created_at >= ?'); p.push(`${from}T00:00:00.000Z`); }
  const to = c.req.query('to');
  if (to) { where.push('o.created_at <= ?'); p.push(`${to}T23:59:59.999Z`); }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', p };
}

r.get('/orders', async (c) => {
  admin(c);
  const f = orderFilters(c);
  const page = Math.max(1, Number(c.req.query('page') ?? 1));
  const rows = await all(c.env.DB, `${ORDER_LIST_SQL} ${f.sql} ORDER BY o.created_at DESC LIMIT 50 OFFSET ?`, ...f.p, (page - 1) * 50);
  return c.json({ page, items: rows.map((o) => ({ ...o, status_label: STATUS_LABELS[o.status as OrderStatus], pickup: parseJson(o.pickup_snapshot, {}), dropoff: parseJson(o.dropoff_snapshot, {}), pickup_snapshot: undefined, dropoff_snapshot: undefined })) });
});

r.get('/orders/export.csv', async (c) => {
  const u = admin(c);
  const f = orderFilters(c);
  const rows = await all(c.env.DB, `${ORDER_LIST_SQL} ${f.sql} ORDER BY o.created_at DESC LIMIT 5000`, ...f.p);
  await c.env.DB.batch([auditStmt(c.env.DB, who(u), 'orders.export', 'orders', null, c.req.url)]);
  const out = rows.map((o) => ({
    codigo: o.code, estado: STATUS_LABELS[o.status as OrderStatus], modalidade: o.service_type, peso_kg: o.weight_kg, distancia_km: Number(o.road_distance_m) / 1000,
    preco_mt: Number(o.price_cents) / 100, pagamento: o.payment_method, estado_pagamento: o.payment_status, cliente: o.customer, estafeta: o.courier ?? '',
    criado_em: o.created_at, agendado_para: o.scheduled_at ?? '',
  }));
  return new Response(csv(out), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="encomendas.csv"' } });
});

r.get('/orders/:id', async (c) => {
  admin(c);
  const o = await one<Record<string, unknown>>(c.env.DB, `${ORDER_LIST_SQL} WHERE o.id = ?`, c.req.param('id'));
  if (!o) throw notFound();
  const full = await one<Record<string, unknown>>(c.env.DB, 'SELECT recipient_name, recipient_phone, category, description, notes, cancel_reason, pricing_snapshot, assigned_courier_id, customer_id, delivery_code_attempts FROM orders WHERE id = ?', c.req.param('id'));
  return c.json({
    ...o,
    ...full,
    recipient_phone: maskPhone(String(full?.recipient_phone ?? '')),
    status_label: STATUS_LABELS[o.status as OrderStatus],
    pickup: parseJson(o.pickup_snapshot, {}),
    dropoff: parseJson(o.dropoff_snapshot, {}),
    pricing: parseJson(full?.pricing_snapshot, {}),
    pickup_snapshot: undefined, dropoff_snapshot: undefined, pricing_snapshot: undefined,
    events: await all(c.env.DB, 'SELECT e.from_status, e.to_status, e.actor_role, e.note, e.created_at, u.name AS actor FROM order_events e LEFT JOIN users u ON u.id = e.actor_id WHERE order_id = ? ORDER BY e.created_at', c.req.param('id')),
    assignments: await all(c.env.DB, 'SELECT a.*, u.name AS courier FROM assignments a JOIN users u ON u.id = a.courier_id WHERE order_id = ? ORDER BY a.created_at', c.req.param('id')),
    proofs: await all(c.env.DB, 'SELECT kind, method, checklist, CASE WHEN photo_r2_key IS NOT NULL THEN 1 ELSE 0 END AS has_photo, created_at FROM delivery_proofs WHERE order_id = ?', c.req.param('id')),
    incidents: await all(c.env.DB, 'SELECT * FROM incident_reports WHERE order_id = ? ORDER BY created_at', c.req.param('id')),
    payments: await all(c.env.DB, 'SELECT id, provider, status, amount_cents, provider_ref, created_at FROM payment_intents WHERE order_id = ? ORDER BY created_at', c.req.param('id')),
    location: await one(c.env.DB, 'SELECT lat, lon, updated_at FROM location_updates WHERE order_id = ?', c.req.param('id')),
  });
});

/** Estafetas elegíveis para atribuição manual: activos, online, com veículo que suporta o peso e sem entrega activa. */
r.get('/orders/:id/eligible-couriers', async (c) => {
  admin(c);
  const o = await one<{ weight_kg: number }>(c.env.DB, 'SELECT weight_kg FROM orders WHERE id = ?', c.req.param('id'));
  if (!o) throw notFound();
  const rows = await all<{ user_id: string; name: string; is_online: number; capacity_kg: number; status: string; busy: number }>(
    c.env.DB,
    `SELECT p.user_id, u.name, p.is_online, v.capacity_kg, v.status,
            EXISTS (SELECT 1 FROM orders x WHERE x.assigned_courier_id = p.user_id AND x.status IN ('ATRIBUIDO','ACEITE','RECOLHIDO','EM_TRANSPORTE')) AS busy
       FROM courier_profiles p JOIN users u ON u.id = p.user_id JOIN vehicles v ON v.courier_id = p.user_id AND v.status = 'approved'
      WHERE p.status = 'active'`,
  );
  return c.json(rows.filter((x) => vehicleCanCarry(x, o.weight_kg) && !x.busy).map((x) => ({ user_id: x.user_id, name: x.name, online: !!x.is_online, capacity_kg: x.capacity_kg })));
});

r.post('/orders/:id/assign', async (c) => {
  const u = admin(c);
  const b = need<{ courier_id: string; reason: string }>(await c.req.json(), { courier_id: v.str(10, 64), ...reasonRule });
  const o = await one<OrderRow>(c.env.DB, 'SELECT * FROM orders WHERE id = ?', c.req.param('id'));
  if (!o) throw notFound();
  const veh = await one<{ status: string; capacity_kg: number }>(
    c.env.DB,
    "SELECT v.status, v.capacity_kg FROM vehicles v JOIN courier_profiles p ON p.user_id = v.courier_id WHERE v.courier_id = ? AND v.status = 'approved' AND p.status = 'active' ORDER BY v.capacity_kg DESC LIMIT 1",
    b.courier_id,
  );
  if (!vehicleCanCarry(veh, o.weight_kg)) throw conflict('inelegivel', 'Este estafeta não está activo ou o veículo não suporta o peso.');
  const now = nowIso();
  const offer = c.env.DB.prepare("INSERT INTO assignments (id, order_id, courier_id, assigned_by, status, reason) VALUES (?,?,?,?, 'offered', ?)").bind(uuid(), o.id, b.courier_id, u.id, b.reason);
  const notifyCourier = notifyStmt(c.env.DB, b.courier_id, `assign:${o.id}:${b.courier_id}:${now}`, 'encomenda', `Nova tarefa ${o.code}`, 'Foi-lhe atribuído um pedido. Aceite ou recuse na app.', o.id);
  let ok: boolean;
  if (o.status === 'PENDENTE_ATRIBUICAO') {
    ok = await transition(c.env.DB, o, 'ATRIBUIDO', { id: u.id, role: 'admin' }, { requireCourier: null, set: { assigned_courier_id: b.courier_id }, note: b.reason, extra: [offer, notifyCourier, auditStmt(c.env.DB, who(u), 'order.assign', 'order', o.id, b.reason)] });
  } else if (['ATRIBUIDO', 'ACEITE'].includes(o.status)) {
    // Reatribuição: volta a pendente e atribui de novo, tudo registado.
    const back = await transition(c.env.DB, o, 'PENDENTE_ATRIBUICAO', { id: u.id, role: 'admin' }, {
      requireCourier: o.assigned_courier_id,
      set: { assigned_courier_id: null },
      note: `Reatribuição: ${b.reason}`,
      extra: [c.env.DB.prepare("UPDATE assignments SET status = 'revoked', reason = ?, responded_at = ? WHERE order_id = ? AND status IN ('offered','accepted')").bind(b.reason, now, o.id)],
    });
    if (!back) throw conflict('estado_mudou', 'O pedido mudou entretanto. Actualize.');
    const fresh = (await one<OrderRow>(c.env.DB, 'SELECT * FROM orders WHERE id = ?', o.id))!;
    ok = await transition(c.env.DB, fresh, 'ATRIBUIDO', { id: u.id, role: 'admin' }, { requireCourier: null, set: { assigned_courier_id: b.courier_id }, note: b.reason, extra: [offer, notifyCourier, auditStmt(c.env.DB, who(u), 'order.reassign', 'order', o.id, b.reason)] });
  } else throw conflict('estado_invalido', 'Só pedidos pendentes, atribuídos ou aceites podem ser (re)atribuídos.');
  if (!ok) throw conflict('estado_mudou', 'O pedido mudou entretanto. Actualize.');
  return c.json({ ok: true });
});

r.post('/orders/:id/status', async (c) => {
  const u = admin(c);
  const b = need<{ to: OrderStatus; reason: string }>(await c.req.json(), { to: v.oneOf('CANCELADO', 'EM_TRANSPORTE', 'DEVOLUCAO_PENDENTE', 'DEVOLVIDO', 'FALHA_ENTREGA', 'PENDENTE_ATRIBUICAO'), ...reasonRule });
  const o = await one<OrderRow>(c.env.DB, 'SELECT * FROM orders WHERE id = ?', c.req.param('id'));
  if (!o) throw notFound();
  const extra: Stmt[] = [auditStmt(c.env.DB, who(u), `order.status.${b.to}`, 'order', o.id, b.reason, { status: o.status }, { status: b.to })];
  const set: Record<string, unknown> = {};
  if (b.to === 'CANCELADO') {
    set.cancel_reason = b.reason;
    if (o.payment_status === 'succeeded') {
      extra.push(c.env.DB.prepare("INSERT INTO refunds (id, intent_id, amount_cents, reason, requested_by) SELECT ?, id, amount_cents, ?, ? FROM payment_intents WHERE order_id = ? AND status = 'succeeded' LIMIT 1").bind(uuid(), `Cancelamento pelo Admin: ${b.reason}`, u.id, o.id));
    }
    extra.push(
      c.env.DB.prepare('UPDATE subscription_entitlements SET deliveries_used = deliveries_used - 1 WHERE id = (SELECT entitlement_id FROM entitlement_usages WHERE order_id = ?) AND deliveries_used > 0').bind(o.id),
      c.env.DB.prepare('DELETE FROM entitlement_usages WHERE order_id = ?').bind(o.id),
    );
  }
  if (b.to === 'PENDENTE_ATRIBUICAO') {
    set.assigned_courier_id = null;
    extra.push(c.env.DB.prepare("UPDATE assignments SET status = 'revoked', reason = ?, responded_at = ? WHERE order_id = ? AND status IN ('offered','accepted')").bind(b.reason, nowIso(), o.id));
  }
  const ok = await transition(c.env.DB, o, b.to, { id: u.id, role: 'admin' }, { note: b.reason, set, extra });
  if (!ok) throw conflict('estado_mudou', 'O pedido mudou entretanto. Actualize.');
  return c.json({ ok: true });
});

r.post('/incidents/:id/resolve', async (c) => {
  const u = admin(c);
  const b = need<{ reason: string }>(await c.req.json(), reasonRule);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE incident_reports SET status = 'resolved' WHERE id = ?").bind(c.req.param('id')),
    auditStmt(c.env.DB, who(u), 'incident.resolve', 'incident', c.req.param('id'), b.reason),
  ]);
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ 06 Subscrições
r.get('/plans', async (c) => {
  admin(c);
  const plans = await all(c.env.DB, `SELECT p.*, (SELECT COUNT(*) FROM subscriptions s WHERE s.plan_id = p.id AND s.status = 'active') AS active_subscribers FROM subscription_plans p ORDER BY p.created_at DESC`);
  const subs = await all(
    c.env.DB,
    `SELECT s.id, s.status, s.auto_renew, s.current_period_end, s.created_at, u.name AS customer, (s.plan_snapshot::jsonb ->> 'name') AS plan,
            e.deliveries_used, e.deliveries_total
       FROM subscriptions s JOIN users u ON u.id = s.customer_id
       LEFT JOIN subscription_entitlements e ON e.subscription_id = s.id AND e.period_start = s.current_period_start
      ORDER BY s.created_at DESC LIMIT 200`,
  );
  const invoices = await all(c.env.DB, 'SELECT i.*, u.name AS customer FROM invoices i JOIN users u ON u.id = i.customer_id ORDER BY i.created_at DESC LIMIT 100');
  return c.json({ plans: plans.map((p) => ({ ...p, service_types: parseJson(p.service_types, []) })), subscriptions: subs, invoices });
});

const planRules = {
  name: v.str(2, 60), description: v.optStr(500), price_cents: v.int(0, 1e8), period_days: v.int(1, 365), deliveries_included: v.int(0, 1000),
  max_weight_kg: v.num(0.5, 15), service_types: (x: unknown) => (Array.isArray(x) && x.length && x.every((t) => t === 'normal' || t === 'expressa') ? null : 'Escolha a modalidade.'),
};

r.post('/plans', async (c) => {
  const u = admin(c);
  const b = need<{ name: string; description?: string; price_cents: number; period_days: number; deliveries_included: number; max_weight_kg: number; service_types: string[] }>(await c.req.json(), planRules);
  const id = uuid();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO subscription_plans (id, name, description, price_cents, period_days, deliveries_included, max_weight_kg, service_types) VALUES (?,?,?,?,?,?,?,?)').bind(
      id, b.name, b.description ?? '', b.price_cents, b.period_days, b.deliveries_included, b.max_weight_kg, JSON.stringify(b.service_types),
    ),
    auditStmt(c.env.DB, who(u), 'plan.create', 'subscription_plan', id, null, null, b),
  ]);
  return c.json({ id }, 201);
});

/** Editar só é possível em rascunho. Contratos activos guardam as condições originais (snapshot). */
r.put('/plans/:id', async (c) => {
  const u = admin(c);
  const b = need<{ name: string; description?: string; price_cents: number; period_days: number; deliveries_included: number; max_weight_kg: number; service_types: string[] }>(await c.req.json(), planRules);
  const p = await one<{ status: string }>(c.env.DB, 'SELECT status FROM subscription_plans WHERE id = ?', c.req.param('id'));
  if (!p) throw notFound();
  if (p.status !== 'draft') throw conflict('plano_publicado', 'Planos publicados não se editam. Arquive e crie um novo.');
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE subscription_plans SET name=?, description=?, price_cents=?, period_days=?, deliveries_included=?, max_weight_kg=?, service_types=?, updated_at=? WHERE id = ?').bind(
      b.name, b.description ?? '', b.price_cents, b.period_days, b.deliveries_included, b.max_weight_kg, JSON.stringify(b.service_types), nowIso(), c.req.param('id'),
    ),
    auditStmt(c.env.DB, who(u), 'plan.update', 'subscription_plan', c.req.param('id'), null, null, b),
  ]);
  return c.json({ ok: true });
});

r.post('/plans/:id/status', async (c) => {
  const u = admin(c);
  const b = need<{ status: 'published' | 'archived'; reason: string }>(await c.req.json(), { status: v.oneOf('published', 'archived'), ...reasonRule });
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE subscription_plans SET status = ?, updated_at = ? WHERE id = ?').bind(b.status, nowIso(), c.req.param('id')),
    auditStmt(c.env.DB, who(u), `plan.${b.status}`, 'subscription_plan', c.req.param('id'), b.reason),
  ]);
  return c.json({ ok: true });
});

r.post('/subscriptions/:id/cancel', async (c) => {
  const u = admin(c);
  const b = need<{ reason: string; immediate: boolean }>(await c.req.json(), { ...reasonRule, immediate: v.bool() });
  const s = await one<{ customer_id: string }>(c.env.DB, 'SELECT customer_id FROM subscriptions WHERE id = ?', c.req.param('id'));
  if (!s) throw notFound();
  await c.env.DB.batch([
    b.immediate
      ? c.env.DB.prepare("UPDATE subscriptions SET status = 'cancelled', auto_renew = 0, cancelled_at = ? WHERE id = ?").bind(nowIso(), c.req.param('id'))
      : c.env.DB.prepare('UPDATE subscriptions SET auto_renew = 0, cancelled_at = ? WHERE id = ?').bind(nowIso(), c.req.param('id')),
    auditStmt(c.env.DB, who(u), 'subscription.cancel', 'subscription', c.req.param('id'), b.reason, null, { immediate: b.immediate }),
    notifyStmt(c.env.DB, s.customer_id, `sub:${c.req.param('id')}:cancel`, 'subscricao', 'Subscrição cancelada', b.reason),
  ]);
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ 07 Pagamentos
r.get('/payments', async (c) => {
  admin(c);
  const status = c.req.query('status');
  const intents = await all(
    c.env.DB,
    `SELECT p.id, p.provider, p.status, p.amount_cents, p.provider_ref, p.failure_reason, p.created_at, p.updated_at, u.name AS customer, o.code AS order_code, p.subscription_id
       FROM payment_intents p JOIN users u ON u.id = p.customer_id LEFT JOIN orders o ON o.id = p.order_id
      ${status ? 'WHERE p.status = ?' : ''} ORDER BY p.created_at DESC LIMIT 200`,
    ...(status ? [status] : []),
  );
  const refunds = await all(
    c.env.DB,
    `SELECT r.*, rq.name AS requested_by_name, ap.name AS approved_by_name, p.provider FROM refunds r JOIN users rq ON rq.id = r.requested_by
       LEFT JOIN users ap ON ap.id = r.approved_by JOIN payment_intents p ON p.id = r.intent_id ORDER BY r.created_at DESC LIMIT 100`,
  );
  const totals = await one(c.env.DB, "SELECT COALESCE(SUM(CASE WHEN status='succeeded' THEN amount_cents END),0) AS succeeded, COALESCE(SUM(CASE WHEN status='pending' THEN amount_cents END),0) AS pending, COALESCE(SUM(CASE WHEN status='refunded' THEN amount_cents END),0) AS refunded FROM payment_intents");
  return c.json({ intents, refunds, totals });
});

r.get('/payments/:id', async (c) => {
  admin(c);
  const pi = await one(c.env.DB, 'SELECT p.*, u.name AS customer FROM payment_intents p JOIN users u ON u.id = p.customer_id WHERE p.id = ?', c.req.param('id'));
  if (!pi) throw notFound();
  return c.json({ ...pi, msisdn: maskPhone(String((pi as { msisdn: string }).msisdn)), transactions: await all(c.env.DB, 'SELECT id, provider_event_id, kind, status, amount_cents, created_at FROM payment_transactions WHERE intent_id = ? ORDER BY created_at', c.req.param('id')) });
});

r.post('/payments/:id/refunds', async (c) => {
  const u = admin(c);
  const b = need<{ amount_cents: number; reason: string }>(await c.req.json(), { amount_cents: v.int(1, 1e9), ...reasonRule });
  const pi = await one<{ amount_cents: number; status: string }>(c.env.DB, 'SELECT amount_cents, status FROM payment_intents WHERE id = ?', c.req.param('id'));
  if (!pi || pi.status !== 'succeeded') throw conflict('nao_reembolsavel', 'Só pagamentos confirmados podem ser reembolsados.');
  const already = await one<{ s: number }>(c.env.DB, "SELECT COALESCE(SUM(amount_cents),0) AS s FROM refunds WHERE intent_id = ? AND status IN ('requested','approved','done')", c.req.param('id'));
  if ((already?.s ?? 0) + b.amount_cents > pi.amount_cents) throw bad('valor', 'O reembolso excede o valor pago.');
  const id = uuid();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO refunds (id, intent_id, amount_cents, reason, requested_by) VALUES (?,?,?,?,?)').bind(id, c.req.param('id'), b.amount_cents, b.reason, u.id),
    auditStmt(c.env.DB, who(u), 'refund.request', 'refund', id, b.reason),
  ]);
  return c.json({ id }, 201);
});

/** Dupla validação: quem pediu o reembolso não o pode aprovar. */
r.post('/refunds/:id/decide', async (c) => {
  const u = admin(c);
  const b = need<{ decision: 'approved' | 'rejected'; reason: string }>(await c.req.json(), { decision: v.oneOf('approved', 'rejected'), ...reasonRule });
  const rf = await one<{ id: string; intent_id: string; requested_by: string; status: string; amount_cents: number }>(c.env.DB, 'SELECT * FROM refunds WHERE id = ?', c.req.param('id'));
  if (!rf) throw notFound();
  if (rf.status !== 'requested') throw conflict('ja_decidido', 'Este reembolso já foi decidido.');
  if (rf.requested_by === u.id) throw forbidden('Quem pediu o reembolso não o pode aprovar. Peça a outro administrador.');
  const pi = await one<{ amount_cents: number; customer_id: string; order_id: string | null; provider: string }>(c.env.DB, 'SELECT * FROM payment_intents WHERE id = ?', rf.intent_id);
  const stmts = [
    c.env.DB.prepare('UPDATE refunds SET status = ?, approved_by = ? WHERE id = ? AND status = ?').bind(b.decision === 'approved' ? 'done' : 'rejected', u.id, rf.id, 'requested'),
    auditStmt(c.env.DB, who(u), `refund.${b.decision}`, 'refund', rf.id, b.reason),
  ];
  if (b.decision === 'approved' && pi) {
    // Com provedores reais, o estorno é pedido ao provedor aqui (pendência 14.3). Em sandbox regista-se directamente.
    stmts.push(c.env.DB.prepare("INSERT INTO payment_transactions (id, intent_id, provider_event_id, kind, status, amount_cents) VALUES (?,?,?, 'refund', 'succeeded', ?)").bind(uuid(), rf.intent_id, `refund-${rf.id}`, rf.amount_cents));
    if (rf.amount_cents >= pi.amount_cents) {
      stmts.push(c.env.DB.prepare("UPDATE payment_intents SET status = 'refunded', updated_at = ? WHERE id = ?").bind(nowIso(), rf.intent_id));
      if (pi.order_id) stmts.push(c.env.DB.prepare("UPDATE orders SET payment_status = 'refunded', updated_at = ? WHERE id = ?").bind(nowIso(), pi.order_id));
    }
    stmts.push(notifyStmt(c.env.DB, pi.customer_id, `refund:${rf.id}`, 'pagamento', 'Reembolso aprovado', `Reembolso de ${(rf.amount_cents / 100).toFixed(2)} MT aprovado.`, pi.order_id));
  }
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ 08 Tarifas
r.get('/pricing', async (c) => {
  admin(c);
  const versions = await all(c.env.DB, 'SELECT v.*, u.name AS published_by_name FROM pricing_versions v LEFT JOIN users u ON u.id = v.published_by ORDER BY version DESC');
  const rules = await all(c.env.DB, 'SELECT * FROM pricing_rules');
  return c.json(versions.map((x) => ({ ...x, rules: rules.filter((r) => r.pricing_version_id === x.id) })));
});

const ruleCheck = (x: unknown) => {
  if (!Array.isArray(x) || x.length !== 2) return 'Indique as tarifas normal e expressa.';
  for (const r of x as PricingRule[]) {
    if (!['normal', 'expressa'].includes(r.service_type)) return 'Modalidade inválida.';
    for (const k of ['base_cents', 'per_km_cents', 'per_kg_cents', 'min_total_cents'] as const) if (!Number.isInteger(r[k]) || r[k] < 0) return `Valor inválido em ${k}.`;
  }
  return null;
};

r.post('/pricing', async (c) => {
  const u = admin(c);
  const b = need<{ note: string; rules: PricingRule[] }>(await c.req.json(), { note: v.str(3, 300), rules: ruleCheck });
  const next = ((await one<{ m: number }>(c.env.DB, 'SELECT COALESCE(MAX(version),0) AS m FROM pricing_versions'))?.m ?? 0) + 1;
  const id = uuid();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO pricing_versions (id, version, note, created_by) VALUES (?,?,?,?)').bind(id, next, b.note, u.id),
    ...b.rules.map((r) => c.env.DB.prepare('INSERT INTO pricing_rules (pricing_version_id, service_type, base_cents, per_km_cents, per_kg_cents, min_total_cents) VALUES (?,?,?,?,?,?)').bind(id, r.service_type, r.base_cents, r.per_km_cents, r.per_kg_cents, r.min_total_cents)),
    auditStmt(c.env.DB, who(u), 'pricing.draft', 'pricing_version', id, b.note, null, b.rules),
  ]);
  return c.json({ id, version: next }, 201);
});

r.post('/pricing/simulate', async (c) => {
  admin(c);
  const b = need<{ rules: PricingRule[]; distance_km: number; weight_kg: number }>(await c.req.json(), { rules: ruleCheck, distance_km: v.num(0.1, 15), weight_kg: v.num(0.1, 15) });
  return c.json(b.rules.map((r) => ({ service_type: r.service_type, ...priceFor(r, b.distance_km * 1000, b.weight_kg) })));
});

/** Publicar exige confirmação explícita de que os valores estão aprovados (pendência 14.1). */
r.post('/pricing/:id/publish', async (c) => {
  const u = admin(c);
  const b = need<{ approved_confirmation: boolean; reason: string }>(await c.req.json(), { approved_confirmation: (x) => (x === true ? null : 'Confirme que os valores foram aprovados pela direcção.'), ...reasonRule });
  const pv = await one<{ id: string; status: string; created_by: string }>(c.env.DB, 'SELECT * FROM pricing_versions WHERE id = ?', c.req.param('id'));
  if (!pv) throw notFound();
  if (pv.status !== 'draft') throw conflict('nao_rascunho', 'Só rascunhos podem ser publicados.');
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE pricing_versions SET status = 'retired' WHERE status = 'published'"),
    c.env.DB.prepare("UPDATE pricing_versions SET status = 'published', published_by = ?, published_at = ? WHERE id = ?").bind(u.id, now, pv.id),
    auditStmt(c.env.DB, who(u), 'pricing.publish', 'pricing_version', pv.id, b.reason),
  ]);
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ 09 Zonas
r.get('/zones', async (c) => {
  admin(c);
  return c.json((await all(c.env.DB, 'SELECT * FROM service_zones ORDER BY kind, name')).map((z) => ({ ...z, polygon: parseJson(z.polygon, []) })));
});

const polygonCheck = (x: unknown) =>
  Array.isArray(x) && x.length >= 3 && x.length <= 500 && x.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number')) ? null : 'Desenhe pelo menos 3 pontos.';

r.post('/zones', async (c) => {
  const u = admin(c);
  const b = need<{ city: string; name: string; kind: 'coverage' | 'restricted'; polygon: LonLat[]; reason: string }>(await c.req.json(), {
    city: v.str(2, 60), name: v.str(2, 60), kind: v.oneOf('coverage', 'restricted'), polygon: polygonCheck, ...reasonRule,
  });
  const id = uuid();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO service_zones (id, city, name, kind, polygon, updated_by) VALUES (?,?,?,?,?,?)').bind(id, b.city, b.name, b.kind, JSON.stringify(b.polygon), u.id),
    auditStmt(c.env.DB, who(u), 'zone.create', 'service_zone', id, b.reason, null, b),
  ]);
  return c.json({ id }, 201);
});

r.put('/zones/:id', async (c) => {
  const u = admin(c);
  const b = need<{ name: string; kind: 'coverage' | 'restricted'; polygon: LonLat[]; active: boolean; reason: string }>(await c.req.json(), {
    name: v.str(2, 60), kind: v.oneOf('coverage', 'restricted'), polygon: polygonCheck, active: v.bool(), ...reasonRule,
  });
  const before = await one(c.env.DB, 'SELECT * FROM service_zones WHERE id = ?', c.req.param('id'));
  if (!before) throw notFound();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE service_zones SET name = ?, kind = ?, polygon = ?, active = ?, version = system_settings.version + 1, updated_by = ?, updated_at = ? WHERE id = ?').bind(
      b.name, b.kind, JSON.stringify(b.polygon), b.active ? 1 : 0, u.id, nowIso(), c.req.param('id'),
    ),
    auditStmt(c.env.DB, who(u), 'zone.update', 'service_zone', c.req.param('id'), b.reason, before, b),
  ]);
  return c.json({ ok: true });
});

/** Teste rápido de cobertura e distância por estrada entre dois pontos (usa o mesmo provedor da cotação). */
r.post('/zones/test-route', async (c) => {
  admin(c);
  const b = need<{ from: { lat: number; lon: number }; to: { lat: number; lon: number } }>(await c.req.json(), { from: v.any(), to: v.any() });
  const zones = (await all<{ name: string; kind: string; polygon: string }>(c.env.DB, 'SELECT name, kind, polygon FROM service_zones WHERE active = 1')).map((z) => ({ ...z, polygon: parseJson<LonLat[]>(z.polygon, []) }));
  const inZones = (p: { lat: number; lon: number }) => zones.filter((z) => pointInPolygon(p.lat, p.lon, z.polygon)).map((z) => `${z.name} (${z.kind === 'coverage' ? 'cobertura' : 'restrita'})`);
  const route = await roadRoute(c.env, b.from, b.to);
  return c.json({ route, within_limit: !checkRoadDistance(route.distance_m), message: checkRoadDistance(route.distance_m), from_zones: inZones(b.from), to_zones: inZones(b.to) });
});

// ------------------------------------------------------------------ 10 Reclamações e suporte
r.get('/tickets', async (c) => {
  admin(c);
  const status = c.req.query('status');
  return c.json(await all(
    c.env.DB,
    `SELECT t.*, u.name AS opener, a.name AS assignee FROM support_tickets t JOIN users u ON u.id = t.opened_by LEFT JOIN users a ON a.id = t.assignee_id
      ${status ? 'WHERE t.status = ?' : ''} ORDER BY CASE t.priority WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.updated_at DESC LIMIT 200`,
    ...(status ? [status] : []),
  ));
});

r.get('/tickets/:id', async (c) => {
  admin(c);
  const t = await one(c.env.DB, 'SELECT t.*, u.name AS opener FROM support_tickets t JOIN users u ON u.id = t.opened_by WHERE t.id = ?', c.req.param('id'));
  if (!t) throw notFound();
  return c.json({ ...t, messages: await all(c.env.DB, 'SELECT m.*, u.name AS author FROM ticket_messages m JOIN users u ON u.id = m.author_id WHERE ticket_id = ? ORDER BY m.created_at', c.req.param('id')) });
});

r.post('/tickets/:id/messages', async (c) => {
  const u = admin(c);
  const b = need<{ body: string; internal: boolean }>(await c.req.json(), { body: v.str(1, 4000), internal: v.bool() });
  const t = await one<{ opened_by: string; subject: string }>(c.env.DB, 'SELECT opened_by, subject FROM support_tickets WHERE id = ?', c.req.param('id'));
  if (!t) throw notFound();
  const now = nowIso();
  const stmts = [
    c.env.DB.prepare('INSERT INTO ticket_messages (id, ticket_id, author_id, body, internal) VALUES (?,?,?,?,?)').bind(uuid(), c.req.param('id'), u.id, b.body, b.internal ? 1 : 0),
    c.env.DB.prepare("UPDATE support_tickets SET updated_at = ?, status = CASE WHEN status = 'aberto' THEN 'em_curso' ELSE status END, assignee_id = COALESCE(assignee_id, ?) WHERE id = ?").bind(now, u.id, c.req.param('id')),
  ];
  if (!b.internal) stmts.push(notifyStmt(c.env.DB, t.opened_by, `ticket:${c.req.param('id')}:${now}`, 'apoio', `Resposta: ${t.subject}`, b.body.slice(0, 140)));
  await c.env.DB.batch(stmts);
  return c.json({ ok: true }, 201);
});

r.patch('/tickets/:id', async (c) => {
  const u = admin(c);
  const b = need<{ status?: string; priority?: string; assignee_id?: string | null }>(await c.req.json(), {
    status: (x) => (x === undefined || ['aberto', 'em_curso', 'resolvido', 'fechado'].includes(String(x)) ? null : 'Estado inválido.'),
    priority: (x) => (x === undefined || ['baixa', 'normal', 'alta', 'urgente'].includes(String(x)) ? null : 'Prioridade inválida.'),
    assignee_id: v.any(),
  });
  const before = await one(c.env.DB, 'SELECT status, priority, assignee_id FROM support_tickets WHERE id = ?', c.req.param('id'));
  if (!before) throw notFound();
  const set: Record<string, unknown> = { updated_at: nowIso() };
  if (b.status) set.status = b.status;
  if (b.priority) {
    set.priority = b.priority;
    const hours = { urgente: 2, alta: 8, normal: 24, baixa: 72 }[b.priority as 'normal'];
    set.sla_due_at = new Date(Date.now() + hours * 3_600_000).toISOString();
  }
  if (b.assignee_id !== undefined) set.assignee_id = b.assignee_id;
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE support_tickets SET ${Object.keys(set).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).bind(...Object.values(set), c.req.param('id')),
    auditStmt(c.env.DB, who(u), 'ticket.update', 'support_ticket', c.req.param('id'), null, before, set),
  ]);
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ 11 Relatórios
r.get('/reports/:kind', async (c) => {
  const u = admin(c);
  const from = `${c.req.query('from') ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)}T00:00:00.000Z`;
  const to = `${c.req.query('to') ?? new Date().toISOString().slice(0, 10)}T23:59:59.999Z`;
  const kind = c.req.param('kind');
  let rows: Record<string, unknown>[];
  if (kind === 'operacional') {
    rows = await all(c.env.DB, `SELECT to_char(created_at::timestamptz AT TIME ZONE 'Africa/Maputo', 'YYYY-MM-DD') AS dia, service_type AS modalidade, COUNT(*) AS pedidos,
        SUM(CASE WHEN status='ENTREGUE' THEN 1 ELSE 0 END) AS entregues, SUM(CASE WHEN status='CANCELADO' THEN 1 ELSE 0 END) AS cancelados, SUM(CASE WHEN status IN ('FALHA_ENTREGA','DEVOLVIDO','DEVOLUCAO_PENDENTE') THEN 1 ELSE 0 END) AS falhas,
        ROUND((AVG(road_distance_m)/1000.0)::numeric, 2) AS km_medio, ROUND(AVG(weight_kg)::numeric,2) AS peso_medio
      FROM orders WHERE created_at BETWEEN ? AND ? GROUP BY dia, modalidade ORDER BY dia`, from, to);
  } else if (kind === 'financeiro') {
    rows = await all(c.env.DB, `SELECT to_char(created_at::timestamptz AT TIME ZONE 'Africa/Maputo', 'YYYY-MM-DD') AS dia, provider AS metodo,
        SUM(CASE WHEN status='succeeded' THEN 1 ELSE 0 END) AS pagos, ROUND(SUM(CASE WHEN status='succeeded' THEN amount_cents ELSE 0 END)/100.0,2) AS valor_pago_mt,
        SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS falhados, ROUND(SUM(CASE WHEN status='refunded' THEN amount_cents ELSE 0 END)/100.0,2) AS reembolsado_mt
      FROM payment_intents WHERE created_at BETWEEN ? AND ? GROUP BY dia, metodo ORDER BY dia`, from, to);
  } else if (kind === 'subscricoes') {
    rows = await all(c.env.DB, `SELECT (s.plan_snapshot::jsonb ->> 'name') AS plano, s.status AS estado, COUNT(*) AS subscricoes,
        COALESCE(SUM(e.deliveries_used),0) AS entregas_usadas, COALESCE(SUM(e.deliveries_total),0) AS entregas_incluidas
      FROM subscriptions s LEFT JOIN subscription_entitlements e ON e.subscription_id = s.id
      WHERE s.created_at BETWEEN ? AND ? GROUP BY plano, estado`, from, to);
  } else if (kind === 'desempenho') {
    rows = await all(c.env.DB, `SELECT u.name AS estafeta, p.link_type AS vinculo, COUNT(o.id) AS entregas, ROUND(p.rating_avg::numeric,2) AS avaliacao,
        ROUND(COALESCE((SELECT SUM(amount_cents) FROM earnings_ledger l WHERE l.courier_id = p.user_id AND l.created_at BETWEEN ? AND ?),0)/100.0,2) AS ganhos_mt
      FROM courier_profiles p JOIN users u ON u.id = p.user_id
      LEFT JOIN orders o ON o.assigned_courier_id = p.user_id AND o.status = 'ENTREGUE' AND o.updated_at BETWEEN ? AND ?
      GROUP BY p.user_id, u.name ORDER BY entregas DESC`, from, to, from, to);
  } else throw notFound('Relatório desconhecido.');
  if (c.req.query('format') === 'csv') {
    await c.env.DB.batch([auditStmt(c.env.DB, who(u), 'report.export', 'report', kind, `${from}..${to}`)]);
    return new Response(csv(rows), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="relatorio-${kind}.csv"` } });
  }
  return c.json({ kind, from, to, rows });
});

// ------------------------------------------------------------------ 12 Definições
r.get('/settings', async (c) => {
  admin(c);
  const settings = await all(c.env.DB, 'SELECT s.key, s.value, s.version, s.updated_at, u.name AS updated_by FROM system_settings s LEFT JOIN users u ON u.id = s.updated_by ORDER BY key');
  const hours = await all(c.env.DB, 'SELECT * FROM business_hours ORDER BY weekday, opens_at');
  const admins = await all(c.env.DB, "SELECT u.id, u.name, u.phone, r.role, r.created_at FROM user_roles r JOIN users u ON u.id = r.user_id WHERE r.role IN ('admin','super_admin') ORDER BY u.name");
  return c.json({ settings: settings.map((s) => ({ ...s, value: parseJson(s.value, {}) })), hours, admins: admins.map((a) => ({ ...a, phone: maskPhone(String(a.phone)) })) });
});

const EDITABLE_SETTINGS = ['company', 'limits', 'payments', 'courier_pay', 'scheduling', 'service_types', 'app'];

r.put('/settings/:key', async (c) => {
  const u = admin(c);
  const key = c.req.param('key');
  if (!EDITABLE_SETTINGS.includes(key)) throw notFound();
  const b = need<{ value: Record<string, unknown>; reason: string }>(await c.req.json(), { value: (x) => (x && typeof x === 'object' && !Array.isArray(x) ? null : 'Valor inválido.'), ...reasonRule });
  if (key === 'limits') {
    const l = b.value as { max_weight_kg?: number; max_road_distance_m?: number };
    // Limites aprovados (15 kg, 15 km) só podem baixar, nunca subir pelo painel.
    if ((l.max_weight_kg ?? 15) > 15 || (l.max_road_distance_m ?? 15000) > 15000) throw bad('limites', 'Os limites aprovados são 15 kg e 15 km por estrada.');
  }
  if (['payments', 'limits'].includes(key) && !u.roles.includes('super_admin')) throw forbidden('Só o super-administrador altera pagamentos e limites.');
  const before = await one<{ value: string }>(c.env.DB, 'SELECT value FROM system_settings WHERE key = ?', key);
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO system_settings (key, value, updated_by) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, version = system_settings.version + 1, updated_by = excluded.updated_by, updated_at = ?').bind(key, JSON.stringify(b.value), u.id, nowIso()),
    auditStmt(c.env.DB, who(u), 'settings.update', 'system_setting', key, b.reason, parseJson(before?.value, null), b.value),
  ]);
  return c.json({ ok: true });
});

r.put('/hours', async (c) => {
  const u = admin(c);
  const b = need<{ hours: { weekday: number; opens_at: string; closes_at: string }[]; reason: string }>(await c.req.json(), {
    hours: (x) => (Array.isArray(x) && x.every((h) => Number.isInteger(h.weekday) && h.weekday >= 0 && h.weekday <= 6 && /^\d{2}:\d{2}$/.test(h.opens_at) && /^\d{2}:\d{2}$/.test(h.closes_at) && h.opens_at < h.closes_at) ? null : 'Horário inválido.'),
    ...reasonRule,
  });
  const before = await all(c.env.DB, 'SELECT * FROM business_hours');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM business_hours'),
    ...b.hours.map((h) => c.env.DB.prepare('INSERT INTO business_hours (weekday, opens_at, closes_at) VALUES (?,?,?)').bind(h.weekday, h.opens_at, h.closes_at)),
    auditStmt(c.env.DB, who(u), 'hours.update', 'business_hours', null, b.reason, before, b.hours),
  ]);
  return c.json({ ok: true });
});

/** Só o super-admin gere administradores, e nunca o seu próprio acesso. */
r.post('/admins', async (c) => {
  const u = admin(c);
  if (!u.roles.includes('super_admin')) throw forbidden('Só o super-administrador gere administradores.');
  const b = need<{ phone: string; role: 'admin' | 'super_admin'; grant: boolean; reason: string }>(await c.req.json(), { phone: v.phone(), role: v.oneOf('admin', 'super_admin'), grant: v.bool(), ...reasonRule });
  const target = await one<{ id: string }>(c.env.DB, 'SELECT id FROM users WHERE phone = ?', normalizePhone(b.phone));
  if (!target) throw notFound('Esta pessoa ainda não tem conta. Peça-lhe para se registar na app Cliente.');
  if (target.id === u.id) throw forbidden('Não pode alterar os seus próprios privilégios.');
  await c.env.DB.batch([
    b.grant
      ? c.env.DB.prepare('INSERT INTO user_roles (user_id, role, granted_by) VALUES (?,?,?) ON CONFLICT DO NOTHING').bind(target.id, b.role, u.id)
      : c.env.DB.prepare('DELETE FROM user_roles WHERE user_id = ? AND role = ?').bind(target.id, b.role),
    auditStmt(c.env.DB, who(u), b.grant ? 'role.grant' : 'role.revoke', 'user', target.id, b.reason, null, { role: b.role }),
    ...(b.grant ? [] : [c.env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND app = 'admin' AND revoked_at IS NULL").bind(nowIso(), target.id)]),
  ]);
  return c.json({ ok: true });
});

r.get('/audit', async (c) => {
  admin(c);
  const entity = c.req.query('entity');
  return c.json(await all(
    c.env.DB,
    `SELECT a.id, a.action, a.entity, a.entity_id, a.reason, a.actor_role, a.created_at, u.name AS actor FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
      ${entity ? 'WHERE a.entity = ?' : ''} ORDER BY a.created_at DESC LIMIT 300`,
    ...(entity ? [entity] : []),
  ));
});

export default r;
