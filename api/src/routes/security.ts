// Painel Admin: «Segurança e ocorrências». Centro de ocorrências, dossiê de provas, sinais de risco (LevaGo Safe).
// Todas as consultas ao dossiê e às provas ficam registadas na auditoria. Nada aqui apaga provas ou eventos.
import { Hono } from 'hono';
import { all, bad, conflict, files, forbidden, need, notFound, nowIso, one, parseJson, uuid, v, type AuthUser, type Ctx, type Env, type Vars } from '../lib/core.js';
import { CUSTODY_LABELS, INCIDENT_CATEGORIES, INCIDENT_STATUS_LABELS } from '../lib/custody.js';
import { STATUS_LABELS, type OrderStatus } from '../lib/domain.js';
import { actorRole, auditStmt, guardedBatch, notifyStmt, requireRole } from '../lib/services.js';

const r = new Hono<{ Bindings: Env; Variables: Vars }>();

function admin(c: Ctx): AuthUser {
  const u = requireRole(c, 'admin', 'super_admin');
  if (u.app !== 'admin') throw forbidden('Use o painel administrativo.');
  return u;
}
const who = (u: AuthUser) => ({ id: u.id, role: actorRole(u) });
const maskPhone = (p: string) => (p ? `${p.slice(0, 7)}•••${p.slice(-2)}` : '');
const STATUSES = ['aberta', 'aguarda_provas', 'em_analise', 'resolvida', 'escalada'] as const;

/** Indicadores: ocorrências por tipo, taxa por 100 entregas, tempo de resolução, recolhas suspensas, lacres divergentes. */
r.get('/summary', async (c) => {
  admin(c);
  const since = c.req.query('from') ? `${c.req.query('from')}T00:00:00.000Z` : new Date(Date.now() - 30 * 86_400_000).toISOString();
  const db = c.env.DB;
  const [byStatus, byCategory, delivered, resolution, blocked, seals, otp, risks] = await Promise.all([
    all<{ status: string; n: number }>(db, 'SELECT status, COUNT(*)::int AS n FROM incidents GROUP BY status'),
    all<{ category: string; n: number }>(db, 'SELECT category, COUNT(*)::int AS n FROM incidents WHERE created_at > ? GROUP BY category ORDER BY n DESC', since),
    one<{ n: number }>(db, "SELECT COUNT(*)::int AS n FROM order_events WHERE to_status = 'ENTREGUE' AND created_at > ?", since),
    one<{ hours: number | null }>(
      db,
      "SELECT AVG(EXTRACT(EPOCH FROM (closed_at::timestamptz - created_at::timestamptz)) / 3600)::float AS hours FROM incidents WHERE closed_at IS NOT NULL AND created_at > ?",
      since,
    ),
    one<{ n: number }>(db, "SELECT COUNT(*)::int AS n FROM orders WHERE status = 'RECOLHA_BLOQUEADA'"),
    one<{ n: number }>(db, "SELECT COUNT(*)::int AS n FROM incidents WHERE category = 'lacre_divergente' AND created_at > ?", since),
    one<{ n: number }>(db, "SELECT COUNT(*)::int AS n FROM risk_signals WHERE rule_code = 'OTP_FALHADO' AND created_at > ?", since),
    one<{ n: number }>(db, "SELECT COUNT(*)::int AS n FROM risk_signals WHERE review_status = 'pendente'"),
  ]);
  const total = byCategory.reduce((s, x) => s + x.n, 0);
  return c.json({
    since,
    by_status: byStatus.map((x) => ({ ...x, label: INCIDENT_STATUS_LABELS[x.status] })),
    by_category: byCategory.map((x) => ({ ...x, label: INCIDENT_CATEGORIES[x.category] ?? x.category })),
    incidents_per_100_deliveries: delivered?.n ? Math.round((total / delivered.n) * 1000) / 10 : null,
    avg_resolution_hours: resolution?.hours === null || resolution?.hours === undefined ? null : Math.round(resolution.hours * 10) / 10,
    blocked_pickups: blocked?.n ?? 0,
    seal_anomalies: seals?.n ?? 0,
    otp_alerts: otp?.n ?? 0,
    pending_risk_signals: risks?.n ?? 0,
  });
});

r.get('/incidents', async (c) => {
  admin(c);
  const q = c.req.query();
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.status && (STATUSES as readonly string[]).includes(q.status)) (where.push('i.status = ?'), params.push(q.status));
  if (q.category) (where.push('i.category = ?'), params.push(q.category));
  if (q.from) (where.push('i.created_at >= ?'), params.push(`${q.from}T00:00:00.000Z`));
  if (q.to) (where.push('i.created_at <= ?'), params.push(`${q.to}T23:59:59.999Z`));
  if (q.q) {
    where.push('(i.protocol ILIKE ? OR o.code ILIKE ? OR cu.name ILIKE ? OR co.name ILIKE ?)');
    const like = `%${q.q.trim()}%`;
    params.push(like, like, like, like);
  }
  const page = Math.max(1, Number(q.page) || 1);
  const rows = await all<Record<string, string>>(
    c.env.DB,
    `SELECT i.id, i.protocol, i.category, i.status, i.priority, i.reporter_role, i.created_at, i.updated_at,
            o.id AS order_id, o.code AS order_code, o.status AS order_status, cu.name AS customer, co.name AS courier, a.name AS assignee
       FROM incidents i JOIN orders o ON o.id = i.order_id JOIN users cu ON cu.id = o.customer_id
       LEFT JOIN users co ON co.id = o.assigned_courier_id LEFT JOIN users a ON a.id = i.assigned_to
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY CASE i.status WHEN 'resolvida' THEN 1 ELSE 0 END, CASE i.priority WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, i.created_at DESC
      LIMIT 51 OFFSET ?`,
    ...params,
    (page - 1) * 50,
  );
  return c.json({
    page,
    has_more: rows.length > 50,
    items: rows.slice(0, 50).map((x) => ({
      ...x,
      category_label: INCIDENT_CATEGORIES[x.category] ?? x.category,
      status_label: INCIDENT_STATUS_LABELS[x.status],
      order_status_label: STATUS_LABELS[x.order_status as OrderStatus],
    })),
  });
});

/** Dossiê de provas da ocorrência. A consulta fica na auditoria. */
r.get('/incidents/:id', async (c) => {
  const u = admin(c);
  const db = c.env.DB;
  const i = await one<Record<string, string>>(
    db,
    `SELECT i.*, rep.name AS reporter, a.name AS assignee FROM incidents i LEFT JOIN users rep ON rep.id = i.reporter_id LEFT JOIN users a ON a.id = i.assigned_to WHERE i.id = ?`,
    c.req.param('id'),
  );
  if (!i) throw notFound();
  const o = await one<Record<string, any>>(
    db,
    `SELECT o.id, o.code, o.status, o.category, o.description, o.quantity, o.weight_kg, o.declared_value_cents, o.fragile, o.declaration_accepted_at,
            o.declaration_version, o.seal_code, o.delivery_code_attempts, o.pickup_code_attempts, (o.pickup_code_hash IS NOT NULL) AS has_pickup_code,
            o.recipient_name, o.recipient_phone, o.order_kind, o.created_at, cu.name AS customer, co.name AS courier
       FROM orders o JOIN users cu ON cu.id = o.customer_id LEFT JOIN users co ON co.id = o.assigned_courier_id WHERE o.id = ?`,
    i.order_id,
  );
  const [notes, custody, inspections, evidence, events, risks, related] = await Promise.all([
    all(db, 'SELECT n.kind, n.body, n.internal, n.author_role, n.created_at, u.name AS author FROM incident_notes n LEFT JOIN users u ON u.id = n.author_id WHERE incident_id = ? ORDER BY n.created_at', i.id),
    all<Record<string, string>>(db, 'SELECT c.event_type, c.from_party, c.to_party, c.method, c.inspection_id, c.metadata, c.occurred_at, u.name AS actor FROM custody_events c LEFT JOIN users u ON u.id = c.actor_id WHERE order_id = ? ORDER BY occurred_at', i.order_id),
    all(db, 'SELECT p.*, u.name AS inspector FROM package_inspections p JOIN users u ON u.id = p.inspector_id WHERE order_id = ? ORDER BY p.created_at', i.order_id),
    all(db, 'SELECT e.id, e.stage, e.media_type, e.size_bytes, e.sha256, e.inspection_id, e.incident_id, e.created_at, u.name AS uploaded_by FROM evidence_files e JOIN users u ON u.id = e.uploaded_by WHERE order_id = ? ORDER BY e.created_at', i.order_id),
    all(db, 'SELECT e.from_status, e.to_status, e.actor_role, e.note, e.created_at FROM order_events e WHERE order_id = ? ORDER BY e.created_at', i.order_id),
    all(db, 'SELECT id, rule_code, severity, review_status, evidence, created_at FROM risk_signals WHERE order_id = ? ORDER BY created_at', i.order_id),
    all(db, 'SELECT id, protocol, category, status, created_at FROM incidents WHERE order_id = ? AND id <> ? ORDER BY created_at', i.order_id, i.id),
  ]);
  const delivered = custody.find((x) => x.event_type === 'entrega_confirmada');
  await db.batch([auditStmt(db, who(u), 'incident.view_dossier', 'incident', i.id)]);
  return c.json({
    ...i,
    category_label: INCIDENT_CATEGORIES[i.category] ?? i.category,
    status_label: INCIDENT_STATUS_LABELS[i.status],
    order: o && {
      ...o,
      status_label: STATUS_LABELS[o.status as OrderStatus],
      recipient_phone: maskPhone(String(o.recipient_phone ?? '')),
      // Código de entrega: só o resultado da validação, nunca o código.
      otp: { validated: !!delivered, validated_at: delivered?.occurred_at ?? null, failed_attempts: o.delivery_code_attempts },
    },
    notes,
    custody: custody.map((x) => ({ ...x, label: CUSTODY_LABELS[x.event_type] ?? x.event_type, metadata: parseJson(x.metadata, null) })),
    inspections,
    evidence,
    events: events.map((e: any) => ({ ...e, to_label: STATUS_LABELS[e.to_status as OrderStatus] })),
    risks,
    related,
  });
});

/** Ver uma prova (foto). Só Admin; cada acesso fica na auditoria. */
r.get('/evidence/:id', async (c) => {
  const u = admin(c);
  const e = await one<{ id: string; storage_key: string; sha256: string; order_id: string }>(c.env.DB, 'SELECT id, storage_key, sha256, order_id FROM evidence_files WHERE id = ?', c.req.param('id'));
  if (!e) throw notFound();
  const f = await files(c.env).get(e.storage_key);
  if (!f) throw notFound();
  await c.env.DB.batch([auditStmt(c.env.DB, who(u), 'evidence.view', 'evidence', e.id, null, undefined, { order_id: e.order_id })]);
  return new Response(f.body, {
    headers: { 'content-type': f.contentType, 'cache-control': 'private, no-store', 'x-content-sha256': e.sha256, 'content-disposition': 'inline' },
  });
});

/**
 * Acções sobre a ocorrência. Mudanças de estado e decisões exigem texto (motivo) e ficam na auditoria.
 * Nunca apagam provas, notas ou eventos: só acrescentam.
 */
r.post('/incidents/:id/action', async (c) => {
  const u = admin(c);
  const b = need<{ action: string; body: string; assign_to_me?: boolean; priority?: string }>(await c.req.json(), {
    action: v.oneOf('nota_interna', 'pedir_esclarecimento', 'em_analise', 'escalar', 'resolver', 'reabrir', 'atribuir', 'prioridade'),
    body: v.str(3, 2000),
    assign_to_me: v.optBool(),
    priority: (x) => (x === undefined || ['baixa', 'normal', 'alta', 'urgente'].includes(String(x)) ? null : 'Prioridade inválida.'),
  });
  const i = await one<{ id: string; status: string; protocol: string; reporter_id: string | null; reporter_role: string; order_id: string; priority: string }>(
    c.env.DB, 'SELECT id, status, protocol, reporter_id, reporter_role, order_id, priority FROM incidents WHERE id = ?', c.req.param('id'),
  );
  if (!i) throw notFound();
  const closed = i.status === 'resolvida';
  if (closed && !['reabrir', 'nota_interna'].includes(b.action)) throw conflict('ocorrencia_fechada', 'Reabra a ocorrência antes de a alterar.');
  if (!closed && b.action === 'reabrir') throw bad('nao_fechada', 'A ocorrência não está fechada.');
  const now = nowIso();
  const next: Record<string, string | undefined> = {
    pedir_esclarecimento: 'aguarda_provas', em_analise: 'em_analise', escalar: 'escalada', resolver: 'resolvida', reabrir: 'em_analise',
  };
  const to = next[b.action];
  const kind = b.action === 'nota_interna' ? 'nota_interna' : b.action === 'pedir_esclarecimento' ? 'pedido_esclarecimento' : b.action === 'resolver' ? 'decisao' : 'mudanca_estado';
  const internal = ['nota_interna', 'atribuir', 'prioridade', 'escalar'].includes(b.action);
  const set: string[] = ['updated_at = ?'];
  const params: unknown[] = [now];
  if (to) (set.push('status = ?'), params.push(to));
  if (b.action === 'resolver') (set.push('resolution = ?', 'closed_at = ?'), params.push(b.body.trim(), now));
  if (b.action === 'reabrir') set.push('closed_at = NULL');
  if (b.action === 'atribuir' || b.assign_to_me) (set.push('assigned_to = ?'), params.push(u.id));
  if (b.action === 'prioridade') {
    if (!b.priority) throw bad('prioridade', 'Escolha a prioridade.');
    set.push('priority = ?');
    params.push(b.priority);
  }
  const stmts = [
    c.env.DB.prepare(`UPDATE incidents SET ${set.join(', ')} WHERE id = ? AND status = ?`).bind(...params, i.id, i.status),
    c.env.DB.prepare('INSERT INTO incident_notes (id, incident_id, author_id, author_role, kind, body, internal) VALUES (?,?,?,?,?,?,?)').bind(uuid(), i.id, u.id, actorRole(u), kind, b.body.trim(), internal),
    auditStmt(c.env.DB, who(u), `incident.${b.action}`, 'incident', i.id, b.body.trim(), { status: i.status, priority: i.priority }, { status: to ?? i.status, priority: b.priority ?? i.priority }),
  ];
  // O cliente que reclamou é avisado quando lhe pedem esclarecimentos ou quando há decisão.
  if (i.reporter_id && i.reporter_role === 'customer' && ['pedir_esclarecimento', 'resolver'].includes(b.action)) {
    stmts.push(
      notifyStmt(
        c.env.DB, i.reporter_id, `incident:${i.id}:${b.action}:${now}`, 'ocorrencia',
        b.action === 'resolver' ? `Reclamação ${i.protocol}: decisão` : `Reclamação ${i.protocol}: precisamos de mais informação`, b.body.trim(), i.order_id,
      ),
    );
  }
  const ok = await guardedBatch(c.env.DB, stmts[0]!, stmts.slice(1));
  if (!ok) throw conflict('estado_mudou', 'A ocorrência mudou entretanto. Actualize.');
  return c.json({ ok: true, status: to ?? i.status });
});

// ------------------------------------------------------------------ LevaGo Safe: sinais de risco (triagem humana)
r.get('/risk-signals', async (c) => {
  admin(c);
  const status = c.req.query('status') ?? 'pendente';
  const rows = await all<Record<string, string>>(
    c.env.DB,
    `SELECT s.*, o.code AS order_code, u.name AS subject_name, rv.name AS reviewer
       FROM risk_signals s LEFT JOIN orders o ON o.id = s.order_id
       LEFT JOIN users u ON u.id = s.subject_id LEFT JOIN users rv ON rv.id = s.reviewed_by
      WHERE (? = 'todos' OR s.review_status = ?) ORDER BY s.created_at DESC LIMIT 200`,
    status, status,
  );
  return c.json(rows.map((x) => ({ ...x, evidence: parseJson(x.evidence, null) })));
});

r.post('/risk-signals/:id/review', async (c) => {
  const u = admin(c);
  const b = need<{ status: 'confirmado' | 'descartado'; note: string }>(await c.req.json(), { status: v.oneOf('confirmado', 'descartado'), note: v.str(3, 500) });
  const s = await one<{ id: string; review_status: string }>(c.env.DB, 'SELECT id, review_status FROM risk_signals WHERE id = ?', c.req.param('id'));
  if (!s) throw notFound();
  if (s.review_status !== 'pendente') throw conflict('ja_revisto', 'Este sinal já foi revisto.');
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE risk_signals SET review_status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ? AND review_status = 'pendente'").bind(b.status, b.note.trim(), u.id, nowIso(), s.id),
    auditStmt(c.env.DB, who(u), `risk.${b.status}`, 'risk_signal', s.id, b.note.trim()),
  ]);
  return c.json({ ok: true });
});

/** Auditoria: consulta restrita e paginada (quem fez o quê, quando e porquê). */
r.get('/audit', async (c) => {
  const u = admin(c);
  if (!u.roles.includes('super_admin')) throw forbidden('Só o super-administrador consulta a auditoria completa.');
  const q = c.req.query();
  const page = Math.max(1, Number(q.page) || 1);
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.entity) (where.push('a.entity = ?'), params.push(q.entity));
  if (q.entity_id) (where.push('a.entity_id = ?'), params.push(q.entity_id));
  if (q.action) (where.push('a.action ILIKE ?'), params.push(`%${q.action}%`));
  const rows = await all(
    c.env.DB,
    `SELECT a.id, a.action, a.entity, a.entity_id, a.reason, a.actor_role, a.created_at, u.name AS actor
       FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY a.created_at DESC LIMIT 101 OFFSET ?`,
    ...params,
    (page - 1) * 100,
  );
  return c.json({ page, has_more: rows.length > 100, items: rows.slice(0, 100) });
});

export default r;
