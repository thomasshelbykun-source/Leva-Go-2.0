import { Hono } from 'hono';
import { all, bad, conflict, forbidden, getSetting, need, notFound, nowIso, one, parseJson, run, uuid, v, type Env, type Vars } from '../lib/core';
import { sha256 } from '../lib/crypto';
import { ACTIVE_COURIER_STATUSES, courierEarning, fitsBusinessHours, maputoParts, STATUS_LABELS, vehicleCanCarry, type OrderStatus } from '../lib/domain';
import { auditStmt, earningStmt, guardedBatch, loadHours, notifyStmt, requireRole, transition, type OrderRow } from '../lib/services';

const r = new Hono<{ Bindings: Env; Variables: Vars }>();

const ALLOWED_UPLOADS = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

async function courierState(db: D1Database, userId: string) {
  const profile = await one<{ status: string; link_type: string; is_online: number; rating_avg: number | null; rating_count: number; zone_id: string | null }>(
    db, 'SELECT * FROM courier_profiles WHERE user_id = ?', userId,
  );
  const application = await one<{ id: string; status: string; review_note: string | null; created_at: string }>(
    db, 'SELECT id, status, review_note, created_at FROM courier_applications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', userId,
  );
  const vehicles = await all<{ id: string; kind: string; plate: string | null; capacity_kg: number; status: string; ownership: string; review_note: string | null }>(
    db, 'SELECT id, kind, plate, capacity_kg, status, ownership, review_note FROM vehicles WHERE courier_id = ? ORDER BY created_at', userId,
  );
  const vehicle = vehicles.find((x) => x.status === 'approved') ?? null;
  return { profile, application, vehicles, vehicle };
}

/** Só um estafeta activo, com veículo aprovado, pode trabalhar. */
async function requireActiveCourier(c: Parameters<typeof requireRole>[0]) {
  const u = requireRole(c, 'courier');
  const st = await courierState(c.env.DB, u.id);
  if (st.profile?.status !== 'active') throw forbidden('A sua conta de estafeta não está activa.');
  return { u, ...st };
}

// ------------------------------------------------------------------ Candidatura
r.post('/apply', async (c) => {
  const u = requireRole(c, 'customer', 'courier');
  const b = need<{ link_type: 'proprio' | 'independente'; vehicle_kind: 'bicicleta' | 'motorizada'; plate?: string; ownership: 'empresa' | 'particular'; capacity_kg: number; consent: boolean }>(
    await c.req.json(),
    {
      link_type: v.oneOf('proprio', 'independente'),
      vehicle_kind: v.oneOf('bicicleta', 'motorizada'),
      plate: v.optStr(20),
      ownership: v.oneOf('empresa', 'particular'),
      capacity_kg: v.num(0.5, 15),
      consent: (x) => (x === true ? null : 'É preciso aceitar a verificação de documentos.'),
    },
  );
  if (b.vehicle_kind === 'motorizada' && !b.plate) throw bad('matricula', 'Indique a matrícula da motorizada.');
  const pending = await one(c.env.DB, "SELECT 1 FROM courier_applications WHERE user_id = ? AND status IN ('pending','approved')", u.id);
  if (pending) throw conflict('candidatura_existe', 'Já tem uma candidatura em análise ou aprovada.');
  const appId = uuid();
  const vehicleId = uuid();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO courier_applications (id, user_id, link_type) VALUES (?,?,?)').bind(appId, u.id, b.link_type),
    c.env.DB.prepare(
      `INSERT INTO courier_profiles (user_id, link_type, status) VALUES (?,?, 'pending')
       ON CONFLICT(user_id) DO UPDATE SET link_type = excluded.link_type, updated_at = excluded.updated_at`,
    ).bind(u.id, b.link_type),
    c.env.DB.prepare('INSERT INTO vehicles (id, courier_id, kind, plate, ownership, capacity_kg) VALUES (?,?,?,?,?,?)').bind(vehicleId, u.id, b.vehicle_kind, b.plate ?? null, b.ownership, b.capacity_kg),
  ]);
  return c.json({ application_id: appId, vehicle_id: vehicleId, status: 'pending' }, 201);
});

/** Upload privado de documentos (R2). Os ficheiros só são lidos por URL autorizado. */
r.post('/documents', async (c) => {
  const u = requireRole(c, 'customer', 'courier');
  const form = await c.req.formData();
  const file = form.get('file') as unknown as File | null;
  const kind = String(form.get('kind') ?? '');
  const vehicleId = form.get('vehicle_id') ? String(form.get('vehicle_id')) : null;
  if (!['bi', 'carta_conducao', 'livrete', 'seguro', 'foto', 'outro'].includes(kind)) throw bad('tipo', 'Tipo de documento inválido.');
  if (!file || typeof file.stream !== 'function') throw bad('ficheiro', 'Escolha um ficheiro.');
  if (!ALLOWED_UPLOADS.includes(file.type)) throw bad('ficheiro', 'Use JPG, PNG, WEBP ou PDF.');
  if (file.size > MAX_UPLOAD_BYTES) throw bad('ficheiro', 'O ficheiro tem mais de 5 MB.');
  if (vehicleId && !(await one(c.env.DB, 'SELECT 1 FROM vehicles WHERE id = ? AND courier_id = ?', vehicleId, u.id))) throw notFound('Veículo não encontrado.');
  const id = uuid();
  const key = `couriers/${u.id}/docs/${id}`;
  await c.env.FILES.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
  await run(c.env.DB, 'INSERT INTO courier_documents (id, courier_id, vehicle_id, kind, r2_key, content_type) VALUES (?,?,?,?,?,?)', id, u.id, vehicleId, kind, key, file.type);
  return c.json({ id, kind, status: 'pending' }, 201);
});

r.get('/me', async (c) => {
  const u = requireRole(c, 'customer', 'courier');
  const st = await courierState(c.env.DB, u.id);
  const docs = await all(c.env.DB, 'SELECT id, kind, status, vehicle_id, created_at FROM courier_documents WHERE courier_id = ? ORDER BY created_at', u.id);
  const today = maputoParts(new Date()).date;
  const earnedToday = await one<{ s: number; n: number }>(
    c.env.DB,
    "SELECT COALESCE(SUM(amount_cents),0) AS s, COUNT(*) AS n FROM earnings_ledger WHERE courier_id = ? AND kind = 'entrega' AND datetime(created_at, '+2 hours') >= ?",
    u.id,
    `${today} 00:00:00`,
  );
  const hours = fitsBusinessHours(new Date(), 0, await loadHours(c.env.DB));
  return c.json({
    name: u.name,
    is_courier: u.roles.includes('courier'),
    ...st,
    documents: docs,
    open_now: hours.ok,
    hours_message: hours.reason ?? null,
    today: { earned_cents: earnedToday?.s ?? 0, deliveries: earnedToday?.n ?? 0 },
  });
});

r.post('/availability', async (c) => {
  const { u, profile, vehicle } = await requireActiveCourier(c);
  const b = need<{ online: boolean }>(await c.req.json(), { online: v.bool() });
  if (b.online) {
    if (!vehicle) throw conflict('sem_veiculo', 'Precisa de um veículo aprovado para ficar online.');
    const h = fitsBusinessHours(new Date(), 0, await loadHours(c.env.DB));
    if (!h.ok) throw conflict('fora_horario', h.reason!);
  } else {
    const active = await one(c.env.DB, `SELECT 1 FROM orders WHERE assigned_courier_id = ? AND status IN ('ACEITE','RECOLHIDO','EM_TRANSPORTE')`, u.id);
    if (active) throw conflict('entrega_activa', 'Termine a entrega em curso antes de ficar offline.');
  }
  await run(c.env.DB, 'UPDATE courier_profiles SET is_online = ?, updated_at = ? WHERE user_id = ?', b.online ? 1 : 0, nowIso(), u.id);
  return c.json({ online: b.online, was: !!profile?.is_online });
});

// ------------------------------------------------------------------ Pedidos
/** Ponto aproximado (cerca de 1 km) para o estafeta decidir sem ver a morada exacta antes de aceitar. */
const approx = (p: { lat: number; lon: number; text: string }) => ({ lat: Math.round(p.lat * 100) / 100, lon: Math.round(p.lon * 100) / 100, area: p.text.split(',').slice(-3, -1).join(',').trim() || 'Quelimane' });

r.get('/orders/available', async (c) => {
  const { u, profile, vehicle } = await requireActiveCourier(c);
  if (!profile?.is_online) return c.json({ online: false, items: [] });
  const rows = await all<OrderRow & { pickup_snapshot: string; dropoff_snapshot: string; service_type: string; road_distance_m: number; created_at: string; scheduled_at: string | null }>(
    c.env.DB,
    `SELECT id, code, status, assigned_courier_id, service_type, weight_kg, road_distance_m, price_cents, payment_method, payment_status, pickup_snapshot, dropoff_snapshot, created_at, scheduled_at, customer_id
       FROM orders
      WHERE (status = 'PENDENTE_ATRIBUICAO' AND (scheduled_at IS NULL OR scheduled_at <= ?))
         OR (status = 'ATRIBUIDO' AND assigned_courier_id = ?)
      ORDER BY CASE service_type WHEN 'expressa' THEN 0 ELSE 1 END, created_at
      LIMIT 30`,
    new Date(Date.now() + 30 * 60_000).toISOString(),
    u.id,
  );
  const cfg = await getSetting(c.env.DB, 'courier_pay', { independent_share_bps: 7000, own_per_delivery_cents: 0 });
  return c.json({
    online: true,
    items: rows
      .filter((o) => vehicleCanCarry(vehicle, o.weight_kg))
      .map((o) => {
        const pickup = parseJson<{ lat: number; lon: number; text: string }>(o.pickup_snapshot, null as never);
        const drop = parseJson<{ lat: number; lon: number; text: string }>(o.dropoff_snapshot, null as never);
        return {
          id: o.id, code: o.code, status: o.status, offered_to_me: o.status === 'ATRIBUIDO', service_type: o.service_type, weight_kg: o.weight_kg,
          road_distance_m: o.road_distance_m, scheduled_at: o.scheduled_at, created_at: o.created_at,
          pickup: { text: pickup.text, lat: pickup.lat, lon: pickup.lon },
          dropoff_area: approx(drop),
          earning_cents: courierEarning((profile?.link_type as 'proprio' | 'independente') ?? 'independente', o.price_cents, cfg),
        };
      }),
  });
});

r.get('/orders/active', async (c) => {
  const u = requireRole(c, 'courier');
  const rows = await all(
    c.env.DB,
    `SELECT id, code, status, service_type, weight_kg, pickup_snapshot, dropoff_snapshot, updated_at FROM orders
      WHERE assigned_courier_id = ? AND status IN ('ATRIBUIDO','ACEITE','RECOLHIDO','EM_TRANSPORTE','FALHA_ENTREGA','DEVOLUCAO_PENDENTE') ORDER BY updated_at DESC`,
    u.id,
  );
  return c.json(rows.map((o) => ({ ...o, status_label: STATUS_LABELS[o.status as OrderStatus], pickup: parseJson(o.pickup_snapshot, {}), dropoff: parseJson(o.dropoff_snapshot, {}), pickup_snapshot: undefined, dropoff_snapshot: undefined })));
});

r.get('/orders/history', async (c) => {
  const u = requireRole(c, 'courier');
  return c.json(await all(
    c.env.DB,
    `SELECT o.id, o.code, o.status, o.updated_at, l.amount_cents FROM orders o LEFT JOIN earnings_ledger l ON l.order_id = o.id AND l.courier_id = o.assigned_courier_id
      WHERE o.assigned_courier_id = ? AND o.status IN ('ENTREGUE','DEVOLVIDO','CANCELADO') ORDER BY o.updated_at DESC LIMIT 50`,
    u.id,
  ));
});

r.get('/orders/:id', async (c) => {
  const { u, vehicle } = await requireActiveCourier(c).catch(async () => ({ u: requireRole(c, 'courier'), vehicle: null }));
  const o = await one<OrderRow & Record<string, unknown>>(c.env.DB, 'SELECT * FROM orders WHERE id = ?', c.req.param('id'));
  if (!o) throw notFound();
  const mine = o.assigned_courier_id === u.id;
  const open = o.status === 'PENDENTE_ATRIBUICAO' && vehicleCanCarry(vehicle, o.weight_kg);
  if (!mine && !open) throw notFound();
  const pickup = parseJson<{ text: string; lat: number; lon: number; contact: string | null }>(o.pickup_snapshot, null as never);
  const drop = parseJson<{ text: string; lat: number; lon: number }>(o.dropoff_snapshot, null as never);
  // Contactos e morada exacta do destino só depois de aceitar.
  const accepted = mine && ACTIVE_COURIER_STATUSES.concat(['FALHA_ENTREGA', 'DEVOLUCAO_PENDENTE'] as OrderStatus[]).includes(o.status);
  const customer = accepted ? await one<{ name: string; phone: string }>(c.env.DB, 'SELECT name, phone FROM users WHERE id = ?', o.customer_id) : null;
  const events = mine ? await all(c.env.DB, 'SELECT to_status, created_at FROM order_events WHERE order_id = ? ORDER BY created_at', o.id) : [];
  return c.json({
    id: o.id, code: o.code, status: o.status, status_label: STATUS_LABELS[o.status], mine,
    service_type: o.service_type, category: o.category, description: o.description, notes: accepted ? o.notes : null,
    weight_kg: o.weight_kg, road_distance_m: o.road_distance_m, scheduled_at: o.scheduled_at,
    payment: { method: o.payment_method, status: o.payment_status, collect_cents: o.payment_status === 'collect_on_delivery' ? o.price_cents : 0 },
    pickup: { text: pickup.text, lat: pickup.lat, lon: pickup.lon, contact: accepted ? pickup.contact ?? customer?.phone ?? null : null },
    dropoff: accepted ? drop : approx(drop),
    recipient: accepted ? { name: o.recipient_name, phone: o.recipient_phone } : null,
    customer: customer ? { name: customer.name.split(' ')[0], phone: customer.phone } : null,
    events,
  });
});

/** Aceite atómico: o primeiro estafeta ganha; os outros recebem 409. */
r.post('/orders/:id/accept', async (c) => {
  const { u, profile, vehicle } = await requireActiveCourier(c);
  if (!profile?.is_online) throw conflict('offline', 'Fique online para aceitar pedidos.');
  const busy = await one(c.env.DB, "SELECT 1 FROM orders WHERE assigned_courier_id = ? AND status IN ('ACEITE','RECOLHIDO','EM_TRANSPORTE')", u.id);
  if (busy) throw conflict('entrega_activa', 'Termine a entrega em curso antes de aceitar outra.');
  const o = await one<OrderRow>(c.env.DB, 'SELECT * FROM orders WHERE id = ?', c.req.param('id'));
  if (!o) throw notFound();
  if (!vehicleCanCarry(vehicle, o.weight_kg)) throw conflict('capacidade', 'O seu veículo não suporta o peso desta encomenda.');
  const now = nowIso();
  let ok = false;
  if (o.status === 'PENDENTE_ATRIBUICAO') {
    ok = await transition(c.env.DB, o, 'ACEITE', { id: u.id, role: 'courier' }, {
      requireCourier: null,
      set: { assigned_courier_id: u.id },
      extra: [c.env.DB.prepare("INSERT INTO assignments (id, order_id, courier_id, status, responded_at) VALUES (?,?,?, 'accepted', ?)").bind(uuid(), o.id, u.id, now)],
    });
  } else if (o.status === 'ATRIBUIDO' && o.assigned_courier_id === u.id) {
    ok = await transition(c.env.DB, o, 'ACEITE', { id: u.id, role: 'courier' }, {
      requireCourier: u.id,
      extra: [c.env.DB.prepare("UPDATE assignments SET status = 'accepted', responded_at = ? WHERE order_id = ? AND courier_id = ? AND status = 'offered'").bind(now, o.id, u.id)],
    });
  }
  if (!ok) throw conflict('ja_aceite', 'Este pedido já foi aceite por outro estafeta.');
  return c.json({ ok: true, status: 'ACEITE' });
});

r.post('/orders/:id/decline', async (c) => {
  const u = requireRole(c, 'courier');
  const b = need<{ reason: string }>(await c.req.json(), { reason: v.str(3, 300) });
  const o = await one<OrderRow>(c.env.DB, "SELECT * FROM orders WHERE id = ? AND assigned_courier_id = ? AND status = 'ATRIBUIDO'", c.req.param('id'), u.id);
  if (!o) throw notFound();
  const ok = await transition(c.env.DB, o, 'PENDENTE_ATRIBUICAO', { id: u.id, role: 'courier' }, {
    requireCourier: u.id,
    note: `Recusado: ${b.reason}`,
    set: { assigned_courier_id: null },
    extra: [c.env.DB.prepare("UPDATE assignments SET status = 'declined', reason = ?, responded_at = ? WHERE order_id = ? AND courier_id = ? AND status = 'offered'").bind(b.reason, nowIso(), o.id, u.id)],
  });
  if (!ok) throw conflict('estado_mudou', 'O pedido mudou entretanto.');
  return c.json({ ok: true });
});

async function myOrder(db: D1Database, id: string, courierId: string) {
  const o = await one<OrderRow & { delivery_code_hash: string; delivery_code_attempts: number }>(db, 'SELECT * FROM orders WHERE id = ? AND assigned_courier_id = ?', id, courierId);
  if (!o) throw notFound();
  return o;
}

r.post('/orders/:id/pickup', async (c) => {
  const u = requireRole(c, 'courier');
  const b = need<{ checklist: string[]; photo_key?: string; lat?: number; lon?: number }>(await c.req.json(), {
    checklist: (x) => (Array.isArray(x) && x.length >= 1 ? null : 'Confirme a lista de verificação.'),
    photo_key: v.optStr(200),
    lat: (x) => (x === undefined || typeof x === 'number' ? null : 'inválido'),
    lon: (x) => (x === undefined || typeof x === 'number' ? null : 'inválido'),
  });
  const o = await myOrder(c.env.DB, c.req.param('id'), u.id);
  if (b.photo_key && !b.photo_key.startsWith(`couriers/${u.id}/proofs/`)) throw forbidden();
  const ok = await transition(c.env.DB, o, 'RECOLHIDO', { id: u.id, role: 'courier' }, {
    requireCourier: u.id,
    extra: [
      c.env.DB.prepare("INSERT INTO delivery_proofs (id, order_id, kind, method, checklist, photo_r2_key, lat, lon, created_by) VALUES (?,?, 'pickup', ?, ?, ?, ?, ?, ?)").bind(
        uuid(), o.id, b.photo_key ? 'checklist+foto' : 'checklist', JSON.stringify(b.checklist), b.photo_key ?? null, b.lat ?? null, b.lon ?? null, u.id,
      ),
    ],
  });
  if (!ok) throw conflict('estado_mudou', 'O pedido não está pronto para recolha.');
  return c.json({ ok: true, status: 'RECOLHIDO' });
});

r.post('/orders/:id/start', async (c) => {
  const u = requireRole(c, 'courier');
  const o = await myOrder(c.env.DB, c.req.param('id'), u.id);
  const ok = await transition(c.env.DB, o, 'EM_TRANSPORTE', { id: u.id, role: 'courier' }, { requireCourier: u.id });
  if (!ok) throw conflict('estado_mudou', 'O pedido mudou entretanto.');
  return c.json({ ok: true, status: 'EM_TRANSPORTE' });
});

/** Entrega: o código gerado no servidor tem de coincidir. Finaliza uma única vez. */
r.post('/orders/:id/deliver', async (c) => {
  const u = requireRole(c, 'courier');
  const b = need<{ code: string; checklist: string[]; photo_key?: string; cash_collected?: boolean; lat?: number; lon?: number }>(await c.req.json(), {
    code: (x) => (typeof x === 'string' && /^\d{4}$/.test(x) ? null : 'O código tem 4 dígitos.'),
    checklist: (x) => (Array.isArray(x) ? null : 'Lista inválida.'),
    photo_key: v.optStr(200),
    cash_collected: v.optBool(),
    lat: (x) => (x === undefined || typeof x === 'number' ? null : 'inválido'),
    lon: (x) => (x === undefined || typeof x === 'number' ? null : 'inválido'),
  });
  const o = await myOrder(c.env.DB, c.req.param('id'), u.id);
  if (o.status !== 'EM_TRANSPORTE') throw conflict('estado_invalido', o.status === 'ENTREGUE' ? 'Esta entrega já foi finalizada.' : 'Inicie o transporte antes de entregar.');
  if (o.delivery_code_attempts >= 5) throw conflict('codigo_bloqueado', 'Demasiadas tentativas de código. Contacte o apoio.');
  if ((await sha256(`${o.id}:${b.code}`)) !== o.delivery_code_hash) {
    await run(c.env.DB, 'UPDATE orders SET delivery_code_attempts = delivery_code_attempts + 1 WHERE id = ?', o.id);
    throw bad('codigo_errado', `Código errado. Restam ${4 - o.delivery_code_attempts} tentativas.`);
  }
  if (b.photo_key && !b.photo_key.startsWith(`couriers/${u.id}/proofs/`)) throw forbidden();
  if (o.payment_status === 'collect_on_delivery' && !b.cash_collected) throw bad('cobranca', 'Confirme que recebeu o pagamento do cliente.');
  const extra: D1PreparedStatement[] = [
    c.env.DB.prepare("INSERT INTO delivery_proofs (id, order_id, kind, method, checklist, photo_r2_key, lat, lon, created_by) VALUES (?,?, 'delivery', ?, ?, ?, ?, ?, ?)").bind(
      uuid(), o.id, b.photo_key ? 'codigo+foto' : 'codigo', JSON.stringify(b.checklist), b.photo_key ?? null, b.lat ?? null, b.lon ?? null, u.id,
    ),
    c.env.DB.prepare("UPDATE assignments SET status = 'completed' WHERE order_id = ? AND courier_id = ? AND status = 'accepted'").bind(o.id, u.id),
    c.env.DB.prepare('UPDATE location_updates SET order_id = NULL WHERE courier_id = ?').bind(u.id),
    await earningStmt(c.env.DB, u.id, o),
  ];
  const set: Record<string, unknown> = {};
  if (o.payment_status === 'collect_on_delivery') set.payment_status = 'succeeded';
  const ok = await transition(c.env.DB, o, 'ENTREGUE', { id: u.id, role: 'courier' }, { requireCourier: u.id, set, extra });
  if (!ok) throw conflict('ja_entregue', 'Esta entrega já foi finalizada.');
  return c.json({ ok: true, status: 'ENTREGUE' });
});

r.post('/orders/:id/incident', async (c) => {
  const u = requireRole(c, 'courier');
  const b = need<{ kind: string; description: string; fail_delivery?: boolean }>(await c.req.json(), {
    kind: v.oneOf('acidente', 'destinatario_ausente', 'morada_errada', 'volume_danificado', 'seguranca', 'outro'),
    description: v.str(3, 1000),
    fail_delivery: v.optBool(),
  });
  const o = await myOrder(c.env.DB, c.req.param('id'), u.id);
  const incident = c.env.DB.prepare('INSERT INTO incident_reports (id, order_id, reporter_id, kind, description) VALUES (?,?,?,?,?)').bind(uuid(), o.id, u.id, b.kind, b.description);
  if (b.fail_delivery && ['RECOLHIDO', 'EM_TRANSPORTE'].includes(o.status)) {
    const ok = await transition(c.env.DB, o, 'FALHA_ENTREGA', { id: u.id, role: 'courier' }, { requireCourier: u.id, note: `${b.kind}: ${b.description}`, extra: [incident] });
    if (!ok) throw conflict('estado_mudou', 'O pedido mudou entretanto.');
  } else {
    await c.env.DB.batch([incident]);
  }
  return c.json({ ok: true }, 201);
});

r.post('/orders/:id/returned', async (c) => {
  const u = requireRole(c, 'courier');
  const o = await myOrder(c.env.DB, c.req.param('id'), u.id);
  const ok = await transition(c.env.DB, o, 'DEVOLVIDO', { id: u.id, role: 'courier' }, { requireCourier: u.id, note: 'Devolvido ao ponto de recolha' });
  if (!ok) throw conflict('estado_mudou', 'O pedido mudou entretanto.');
  return c.json({ ok: true });
});

/** Foto de prova (opcional conforme política): devolve a chave privada a enviar na recolha/entrega. */
r.post('/proofs/upload', async (c) => {
  const u = requireRole(c, 'courier');
  const form = await c.req.formData();
  const file = form.get('file') as unknown as File | null;
  if (!file || typeof file.stream !== 'function' || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw bad('ficheiro', 'Envie uma foto JPG, PNG ou WEBP.');
  if (file.size > MAX_UPLOAD_BYTES) throw bad('ficheiro', 'A foto tem mais de 5 MB.');
  const key = `couriers/${u.id}/proofs/${uuid()}`;
  await c.env.FILES.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
  return c.json({ photo_key: key }, 201);
});

/** Posição: só aceite durante uma entrega activa. Guarda apenas a última leitura. */
r.post('/location', async (c) => {
  const u = requireRole(c, 'courier');
  const b = need<{ lat: number; lon: number; accuracy_m?: number }>(await c.req.json(), { lat: v.lat(), lon: v.lon(), accuracy_m: (x) => (x === undefined || typeof x === 'number' ? null : 'inválido') });
  const active = await one<{ id: string }>(c.env.DB, "SELECT id FROM orders WHERE assigned_courier_id = ? AND status IN ('ACEITE','RECOLHIDO','EM_TRANSPORTE') LIMIT 1", u.id);
  if (!active) return c.json({ stored: false, reason: 'Sem entrega activa: a localização não é partilhada.' });
  await run(
    c.env.DB,
    `INSERT INTO location_updates (courier_id, order_id, lat, lon, accuracy_m, updated_at) VALUES (?,?,?,?,?,?)
     ON CONFLICT(courier_id) DO UPDATE SET order_id = excluded.order_id, lat = excluded.lat, lon = excluded.lon, accuracy_m = excluded.accuracy_m, updated_at = excluded.updated_at`,
    u.id, active.id, b.lat, b.lon, b.accuracy_m ?? null, nowIso(),
  );
  return c.json({ stored: true });
});

// ------------------------------------------------------------------ Ganhos
r.get('/earnings', async (c) => {
  const u = requireRole(c, 'courier');
  const period = c.req.query('period') ?? 'week';
  const days = period === 'day' ? 1 : period === 'month' ? 30 : 7;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const entries = await all(
    c.env.DB,
    `SELECT l.id, l.kind, l.amount_cents, l.note, l.created_at, l.payout_id, o.code, p.status AS payout_status
       FROM earnings_ledger l LEFT JOIN orders o ON o.id = l.order_id LEFT JOIN payouts p ON p.id = l.payout_id
      WHERE l.courier_id = ? AND l.created_at >= ? ORDER BY l.created_at DESC`,
    u.id, since,
  );
  const totals = await one<{ total: number; pending: number; deliveries: number }>(
    c.env.DB,
    `SELECT COALESCE(SUM(amount_cents),0) AS total,
            COALESCE(SUM(CASE WHEN payout_id IS NULL THEN amount_cents ELSE 0 END),0) AS pending,
            SUM(CASE WHEN kind = 'entrega' THEN 1 ELSE 0 END) AS deliveries
       FROM earnings_ledger WHERE courier_id = ? AND created_at >= ?`,
    u.id, since,
  );
  const payouts = await all(c.env.DB, 'SELECT id, amount_cents, status, reference, created_at, paid_at FROM payouts WHERE courier_id = ? ORDER BY created_at DESC LIMIT 20', u.id);
  return c.json({ period, ...totals, entries, payouts });
});

r.post('/earnings/:id/dispute', async (c) => {
  const u = requireRole(c, 'courier');
  const b = need<{ message: string }>(await c.req.json(), { message: v.str(5, 1000) });
  const e = await one(c.env.DB, 'SELECT id FROM earnings_ledger WHERE id = ? AND courier_id = ?', c.req.param('id'), u.id);
  if (!e) throw notFound();
  await run(c.env.DB, 'INSERT INTO earning_disputes (id, ledger_id, courier_id, message) VALUES (?,?,?,?)', uuid(), c.req.param('id'), u.id, b.message);
  return c.json({ ok: true }, 201);
});

// ------------------------------------------------------------------ Veículo
r.post('/vehicles', async (c) => {
  const u = requireRole(c, 'courier');
  const b = need<{ kind: 'bicicleta' | 'motorizada'; plate?: string; ownership: 'empresa' | 'particular'; capacity_kg: number }>(await c.req.json(), {
    kind: v.oneOf('bicicleta', 'motorizada'), plate: v.optStr(20), ownership: v.oneOf('empresa', 'particular'), capacity_kg: v.num(0.5, 15),
  });
  if (b.kind === 'motorizada' && !b.plate) throw bad('matricula', 'Indique a matrícula da motorizada.');
  const id = uuid();
  await run(c.env.DB, 'INSERT INTO vehicles (id, courier_id, kind, plate, ownership, capacity_kg) VALUES (?,?,?,?,?,?)', id, u.id, b.kind, b.plate ?? null, b.ownership, b.capacity_kg);
  return c.json({ id, status: 'pending' }, 201);
});

/** Alterar dados do veículo volta a pô-lo em revisão (deixa de receber tarefas até aprovação). */
r.patch('/vehicles/:id', async (c) => {
  const u = requireRole(c, 'courier');
  const b = need<{ plate?: string; capacity_kg: number }>(await c.req.json(), { plate: v.optStr(20), capacity_kg: v.num(0.5, 15) });
  const before = await one(c.env.DB, 'SELECT * FROM vehicles WHERE id = ? AND courier_id = ?', c.req.param('id'), u.id);
  if (!before) throw notFound();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE vehicles SET plate = COALESCE(?, plate), capacity_kg = ?, status = 'pending', updated_at = ? WHERE id = ?").bind(b.plate ?? null, b.capacity_kg, nowIso(), c.req.param('id')),
    auditStmt(c.env.DB, { id: u.id, role: 'courier' }, 'vehicle.update', 'vehicle', c.req.param('id'), 'Alteração pelo estafeta', before, b),
    notifyStmt(c.env.DB, u.id, `vehicle:${c.req.param('id')}:${Date.now()}`, 'conta', 'Veículo em revisão', 'As alterações ao veículo foram enviadas para aprovação.'),
  ]);
  return c.json({ ok: true, status: 'pending' });
});

export default r;
