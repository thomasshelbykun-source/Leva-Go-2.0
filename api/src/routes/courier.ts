import type { Db, Stmt } from '../lib/db.js';
import { Hono } from 'hono';
import { all, bad, conflict, files, forbidden, getSetting, need, notFound, nowIso, one, parseJson, run, uuid, v, type Env, type Vars } from '../lib/core.js';
import { sha256 } from '../lib/crypto.js';
import { ACTIVE_COURIER_STATUSES, courierEarning, fitsBusinessHours, maputoParts, STATUS_LABELS, vehicleCanCarry, type OrderStatus } from '../lib/domain.js';
import { checkPhotoKeys, custodySettings, custodyStmt, evidenceStmts, EXTERNAL_MATCH, INCIDENT_CATEGORIES, incidentStmt, inspectionStmt, PACKAGING, riskStmt } from '../lib/custody.js';
import { auditStmt, earningStmt, guardedBatch, loadHours, notifyStmt, requireRole, transition, type OrderRow } from '../lib/services.js';

const r = new Hono<{ Bindings: Env; Variables: Vars }>();

const ALLOWED_UPLOADS = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // a Vercel aceita pedidos até 4,5 MB

async function courierState(db: Db, userId: string) {
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

/** Upload privado de documentos (guardados na base de dados). Os ficheiros só são lidos por URL autorizado. */
r.post('/documents', async (c) => {
  const u = requireRole(c, 'customer', 'courier');
  const form = await c.req.formData();
  const file = form.get('file') as unknown as File | null;
  const kind = String(form.get('kind') ?? '');
  const vehicleId = form.get('vehicle_id') ? String(form.get('vehicle_id')) : null;
  if (!['bi', 'carta_conducao', 'livrete', 'seguro', 'foto', 'outro'].includes(kind)) throw bad('tipo', 'Tipo de documento inválido.');
  if (!file || typeof file.stream !== 'function') throw bad('ficheiro', 'Escolha um ficheiro.');
  if (!ALLOWED_UPLOADS.includes(file.type)) throw bad('ficheiro', 'Use JPG, PNG, WEBP ou PDF.');
  if (file.size > MAX_UPLOAD_BYTES) throw bad('ficheiro', 'O ficheiro tem mais de 4 MB.');
  if (vehicleId && !(await one(c.env.DB, 'SELECT 1 FROM vehicles WHERE id = ? AND courier_id = ?', vehicleId, u.id))) throw notFound('Veículo não encontrado.');
  const id = uuid();
  const key = `couriers/${u.id}/docs/${id}`;
  await files(c.env).put(key, await file.arrayBuffer(), file.type);
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
    "SELECT COALESCE(SUM(amount_cents),0) AS s, COUNT(*) AS n FROM earnings_ledger WHERE courier_id = ? AND kind = 'entrega' AND to_char(created_at::timestamptz AT TIME ZONE 'Africa/Maputo', 'YYYY-MM-DD HH24:MI:SS') >= ?",
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
      WHERE assigned_courier_id = ? AND status IN ('ATRIBUIDO','ACEITE','RECOLHA_BLOQUEADA','RECOLHIDO','EM_TRANSPORTE','FALHA_ENTREGA','DEVOLUCAO_PENDENTE') ORDER BY updated_at DESC`,
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
  const custody = await custodySettings(c.env.DB);
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
    // Protecção da encomenda: o estafeta vê o que precisa para a inspecção externa, nunca os códigos.
    security: {
      quantity: o.quantity ?? 1,
      fragile: !!o.fragile,
      pickup_code_required: !!o.pickup_code_hash && custody.pickup_code_required,
      seal_registered: !!o.seal_code,
      seal_required: custody.seal_required,
      pickup_photos_min: custody.pickup_photos_min,
      dropoff_photos_min: custody.dropoff_photos_min,
    },
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

async function myOrder(db: Db, id: string, courierId: string) {
  const o = await one<OrderRow & { delivery_code_hash: string; delivery_code_attempts: number; pickup_code_hash: string | null; pickup_code_attempts: number; seal_code: string | null; weight_kg: number }>(db, 'SELECT * FROM orders WHERE id = ? AND assigned_courier_id = ?', id, courierId);
  if (!o) throw notFound();
  return o;
}

const photoList = (x: unknown) => (x === undefined || (Array.isArray(x) && x.every((k) => typeof k === 'string')) ? null : 'Lista de fotos inválida.');
const optNum = (min: number, max: number) => (x: unknown) => (x === undefined || x === null || (typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max) ? null : `Número entre ${min} e ${max}.`);
const courierParty = (id: string) => `estafeta:${id}`;
const proofPrefix = (id: string) => `couriers/${id}/proofs/`;

/**
 * Recolha com inspecção externa (Fase B). O estafeta não abre a encomenda.
 * Embalagem aberta, danificada, insegura, descrição divergente ou peso acima do limite: suspende a recolha e abre ocorrência.
 * Caso normal: exige fotos, código do remetente (quando activo) e lacre (quando obrigatório). Tudo numa só transacção.
 */
r.post('/orders/:id/pickup', async (c) => {
  const u = requireRole(c, 'courier');
  const b = need<{
    packaging_condition: (typeof PACKAGING)[number]; external_match: (typeof EXTERNAL_MATCH)[number]; photo_keys?: string[]; photo_key?: string;
    pickup_code?: string; seal_code?: string; measured_weight_kg?: number; weight_method?: string; notes?: string; checklist?: string[]; lat?: number; lon?: number;
  }>(await c.req.json(), {
    packaging_condition: v.oneOf(...PACKAGING),
    external_match: v.oneOf(...EXTERNAL_MATCH),
    photo_keys: photoList,
    photo_key: v.optStr(200),
    pickup_code: (x) => (x === undefined || x === null || x === '' || (typeof x === 'string' && /^\d{4}$/.test(x)) ? null : 'O código de recolha tem 4 dígitos.'),
    seal_code: (x) => (x === undefined || x === null || x === '' || (typeof x === 'string' && /^[A-Za-z0-9-]{3,40}$/.test(x)) ? null : 'Número do lacre inválido.'),
    measured_weight_kg: optNum(0.01, 100),
    weight_method: v.optStr(60),
    notes: v.optStr(500),
    checklist: photoList,
    lat: optNum(-90, 90),
    lon: optNum(-180, 180),
  });
  const o = await myOrder(c.env.DB, c.req.param('id'), u.id);
  if (o.status === 'RECOLHIDO' || o.status === 'EM_TRANSPORTE') return c.json({ ok: true, status: o.status }); // repetição do mesmo toque
  if (o.status !== 'ACEITE') throw conflict('estado_invalido', 'O pedido não está pronto para recolha.');
  const cfg = await custodySettings(c.env.DB);
  const limits = await getSetting(c.env.DB, 'limits', { max_weight_kg: 15 });
  const keys = await checkPhotoKeys(c.env.DB, [...(b.photo_keys ?? []), ...(b.photo_key ? [b.photo_key] : [])], proofPrefix(u.id), cfg.pickup_photos_min);
  const seal = b.seal_code ? b.seal_code.trim().toUpperCase() : null;
  const inspectionId = uuid();
  const base = {
    orderId: o.id, stage: 'pickup' as const, inspectorId: u.id, packaging: b.packaging_condition, externalMatch: b.external_match,
    measuredWeightKg: b.measured_weight_kg ?? null, weightMethod: b.weight_method ?? null, sealCode: seal, notes: b.notes ?? null,
  };

  // Recolha suspensa: não se conclui; fica registada com provas e ocorrência para decisão do Admin.
  const overWeight = b.measured_weight_kg !== undefined && b.measured_weight_kg > limits.max_weight_kg;
  const block =
    b.packaging_condition !== 'intacta' ? `embalagem_${b.packaging_condition}` : b.external_match === 'nao' ? 'descricao_divergente' : overWeight ? 'peso_acima_limite' : null;
  if (block) {
    const incidentId = uuid();
    const ok = await transition(c.env.DB, o, 'RECOLHA_BLOQUEADA', { id: u.id, role: 'courier' }, {
      requireCourier: u.id,
      note: INCIDENT_CATEGORIES[block],
      extra: [
        inspectionStmt(c.env.DB, inspectionId, { ...base, outcome: 'bloqueada' }),
        ...evidenceStmts(c.env.DB, keys, { orderId: o.id, stage: 'pickup', uploadedBy: u.id, inspectionId }),
        incidentStmt(c.env.DB, incidentId, { orderId: o.id, reporterId: u.id, role: 'courier', category: block, description: b.notes?.trim() || INCIDENT_CATEGORIES[block], priority: 'alta' }),
        custodyStmt(c.env.DB, { orderId: o.id, type: 'recolha_suspensa', from: 'remetente', to: 'remetente', actorId: u.id, inspectionId }),
        riskStmt(c.env.DB, { rule: 'RECOLHA_SUSPENSA', severity: 'media', subjectType: 'order', subjectId: o.id, orderId: o.id, evidence: { motivo: block }, dedupe: `recolha:${o.id}:${inspectionId}` }),
      ],
    });
    if (!ok) throw conflict('estado_mudou', 'O pedido mudou entretanto.');
    const inc = await one<{ protocol: string }>(c.env.DB, 'SELECT protocol FROM incidents WHERE id = ?', incidentId);
    return c.json({ ok: true, status: 'RECOLHA_BLOQUEADA', incident: inc?.protocol }, 201);
  }

  if (cfg.seal_required && !seal) throw bad('lacre', 'Registe o número do lacre.');
  // Confirmação do remetente: código de 4 dígitos que só o remetente conhece (guardado como hash).
  if (cfg.pickup_code_required && o.pickup_code_hash) {
    if (o.pickup_code_attempts >= 5) throw conflict('codigo_bloqueado', 'Demasiadas tentativas do código de recolha. Contacte o apoio.');
    if (!b.pickup_code) throw bad('codigo_recolha', 'Peça ao remetente o código de recolha.');
    if ((await sha256(`${o.id}:recolha:${b.pickup_code}`)) !== o.pickup_code_hash) {
      const n = o.pickup_code_attempts + 1;
      await c.env.DB.batch([
        c.env.DB.prepare('UPDATE orders SET pickup_code_attempts = pickup_code_attempts + 1 WHERE id = ?').bind(o.id),
        ...(n >= cfg.otp_risk_threshold
          ? [riskStmt(c.env.DB, { rule: 'CODIGO_RECOLHA_FALHADO', severity: 'media', subjectType: 'courier', subjectId: u.id, orderId: o.id, evidence: { tentativas: n }, dedupe: `codrec:${o.id}` })]
          : []),
      ]);
      throw bad('codigo_errado', `Código de recolha errado. Restam ${Math.max(0, 5 - n)} tentativas.`);
    }
  }
  const declared = Number(o.weight_kg);
  const weightAlert = b.measured_weight_kg !== undefined && b.measured_weight_kg > declared * 1.2 + 0.5;
  const ok = await transition(c.env.DB, o, 'RECOLHIDO', { id: u.id, role: 'courier' }, {
    requireCourier: u.id,
    set: seal ? { seal_code: seal } : {},
    extra: [
      inspectionStmt(c.env.DB, inspectionId, { ...base, outcome: 'aprovada' }),
      ...evidenceStmts(c.env.DB, keys, { orderId: o.id, stage: 'pickup', uploadedBy: u.id, inspectionId }),
      custodyStmt(c.env.DB, { orderId: o.id, type: 'recolha_confirmada', from: 'remetente', to: courierParty(u.id), actorId: u.id, method: o.pickup_code_hash && cfg.pickup_code_required ? 'codigo_remetente' : 'inspeccao_estafeta', inspectionId }),
      c.env.DB.prepare("INSERT INTO delivery_proofs (id, order_id, kind, method, checklist, photo_r2_key, lat, lon, created_by) VALUES (?,?, 'pickup', ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING").bind(
        uuid(), o.id, o.pickup_code_hash ? 'codigo+inspeccao' : 'inspeccao', JSON.stringify(b.checklist ?? []), keys[0] ?? null, b.lat ?? null, b.lon ?? null, u.id,
      ),
      ...(weightAlert
        ? [riskStmt(c.env.DB, { rule: 'PESO_DIVERGENTE', severity: 'baixa', subjectType: 'order', subjectId: o.id, orderId: o.id, evidence: { declarado: declared, medido: b.measured_weight_kg }, dedupe: `peso:${o.id}` })]
        : []),
    ],
  });
  if (!ok) throw conflict('estado_mudou', 'O pedido não está pronto para recolha.');
  return c.json({ ok: true, status: 'RECOLHIDO' });
});

r.post('/orders/:id/start', async (c) => {
  const u = requireRole(c, 'courier');
  const o = await myOrder(c.env.DB, c.req.param('id'), u.id);
  if (o.status === 'EM_TRANSPORTE') return c.json({ ok: true, status: 'EM_TRANSPORTE' });
  const ok = await transition(c.env.DB, o, 'EM_TRANSPORTE', { id: u.id, role: 'courier' }, { requireCourier: u.id });
  if (!ok) throw conflict('estado_mudou', 'O pedido mudou entretanto.');
  return c.json({ ok: true, status: 'EM_TRANSPORTE' });
});

/**
 * Entrega (Fase D). O código do destinatário é validado só no servidor (hash, 5 tentativas).
 * Anomalia na embalagem ou lacre diferente: não se marca entregue; regista-se falha e ocorrência.
 */
r.post('/orders/:id/deliver', async (c) => {
  const u = requireRole(c, 'courier');
  const b = need<{
    code?: string; packaging_condition?: (typeof PACKAGING)[number]; recipient_verdict?: 'sem_anomalias' | 'anomalia'; seal_code?: string;
    photo_keys?: string[]; photo_key?: string; notes?: string; checklist?: string[]; cash_collected?: boolean; lat?: number; lon?: number;
  }>(await c.req.json(), {
    code: (x) => (x === undefined || x === null || x === '' || (typeof x === 'string' && /^\d{4}$/.test(x)) ? null : 'O código tem 4 dígitos.'),
    packaging_condition: (x) => (x === undefined || (PACKAGING as readonly string[]).includes(String(x)) ? null : 'Estado da embalagem inválido.'),
    recipient_verdict: (x) => (x === undefined || x === 'sem_anomalias' || x === 'anomalia' ? null : 'Resposta do destinatário inválida.'),
    seal_code: v.optStr(40),
    photo_keys: photoList,
    photo_key: v.optStr(200),
    notes: v.optStr(500),
    checklist: photoList,
    cash_collected: v.optBool(),
    lat: optNum(-90, 90),
    lon: optNum(-180, 180),
  });
  const o = await myOrder(c.env.DB, c.req.param('id'), u.id);
  if (o.status !== 'EM_TRANSPORTE') throw conflict('estado_invalido', o.status === 'ENTREGUE' ? 'Esta entrega já foi finalizada.' : 'Inicie o transporte antes de entregar.');
  const cfg = await custodySettings(c.env.DB);
  const packaging = b.packaging_condition ?? 'intacta';
  const verdict = b.recipient_verdict ?? 'sem_anomalias';
  const keys = await checkPhotoKeys(c.env.DB, [...(b.photo_keys ?? []), ...(b.photo_key ? [b.photo_key] : [])], proofPrefix(u.id), packaging === 'intacta' && verdict === 'sem_anomalias' ? cfg.dropoff_photos_min : Math.max(1, cfg.dropoff_photos_min));
  const seal = b.seal_code ? b.seal_code.trim().toUpperCase() : null;
  if (o.seal_code && !seal && packaging === 'intacta' && verdict === 'sem_anomalias') throw bad('lacre', 'Leia o código do lacre antes de entregar.');
  const sealMismatch = !!o.seal_code && !!seal && seal !== o.seal_code;
  const inspectionId = uuid();
  const base = { orderId: o.id, stage: 'dropoff' as const, inspectorId: u.id, packaging, recipientVerdict: verdict, sealCode: seal, notes: b.notes ?? null };

  if (packaging !== 'intacta' || verdict === 'anomalia' || sealMismatch) {
    const category = sealMismatch ? 'lacre_divergente' : 'anomalia_na_entrega';
    const incidentId = uuid();
    const ok = await transition(c.env.DB, o, 'FALHA_ENTREGA', { id: u.id, role: 'courier' }, {
      requireCourier: u.id,
      note: INCIDENT_CATEGORIES[category],
      extra: [
        inspectionStmt(c.env.DB, inspectionId, { ...base, outcome: 'bloqueada' }),
        ...evidenceStmts(c.env.DB, keys, { orderId: o.id, stage: 'dropoff', uploadedBy: u.id, inspectionId }),
        incidentStmt(c.env.DB, incidentId, { orderId: o.id, reporterId: u.id, role: 'courier', category, description: b.notes?.trim() || INCIDENT_CATEGORIES[category], priority: 'alta' }),
        custodyStmt(c.env.DB, { orderId: o.id, type: 'entrega_falhada', from: courierParty(u.id), to: courierParty(u.id), actorId: u.id, inspectionId, metadata: { motivo: category } }),
        ...(sealMismatch
          ? [riskStmt(c.env.DB, { rule: 'LACRE_DIVERGENTE', severity: 'alta', subjectType: 'order', subjectId: o.id, orderId: o.id, evidence: { lacre_lido: seal ?? '(sem lacre)' }, dedupe: `lacre:${o.id}` })]
          : []),
      ],
    });
    if (!ok) throw conflict('estado_mudou', 'O pedido mudou entretanto.');
    const inc = await one<{ protocol: string }>(c.env.DB, 'SELECT protocol FROM incidents WHERE id = ?', incidentId);
    return c.json({ ok: true, status: 'FALHA_ENTREGA', incident: inc?.protocol }, 201);
  }

  if (!b.code) throw bad('codigo', 'Peça ao destinatário o código de entrega.');
  if (o.delivery_code_attempts >= 5) throw conflict('codigo_bloqueado', 'Demasiadas tentativas de código. Contacte o apoio.');
  if ((await sha256(`${o.id}:${b.code}`)) !== o.delivery_code_hash) {
    const n = o.delivery_code_attempts + 1;
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE orders SET delivery_code_attempts = delivery_code_attempts + 1 WHERE id = ?').bind(o.id),
      ...(n >= cfg.otp_risk_threshold
        ? [riskStmt(c.env.DB, { rule: 'OTP_FALHADO', severity: n >= 5 ? 'alta' : 'media', subjectType: 'courier', subjectId: u.id, orderId: o.id, evidence: { tentativas: n }, dedupe: `otp:${o.id}` })]
        : []),
    ]);
    throw bad('codigo_errado', `Código errado. Restam ${Math.max(0, 5 - n)} tentativas.`);
  }
  if (o.payment_status === 'collect_on_delivery' && !b.cash_collected) throw bad('cobranca', 'Confirme que recebeu o pagamento do cliente.');
  const extra: Stmt[] = [
    inspectionStmt(c.env.DB, inspectionId, { ...base, outcome: 'aprovada' }),
    ...evidenceStmts(c.env.DB, keys, { orderId: o.id, stage: 'dropoff', uploadedBy: u.id, inspectionId }),
    custodyStmt(c.env.DB, { orderId: o.id, type: 'entrega_confirmada', from: courierParty(u.id), to: 'destinatario', actorId: u.id, method: 'otp_destinatario', inspectionId }),
    c.env.DB.prepare("INSERT INTO delivery_proofs (id, order_id, kind, method, checklist, photo_r2_key, lat, lon, created_by) VALUES (?,?, 'delivery', ?, ?, ?, ?, ?, ?)").bind(
      uuid(), o.id, keys.length ? 'codigo+foto' : 'codigo', JSON.stringify(b.checklist ?? []), keys[0] ?? null, b.lat ?? null, b.lon ?? null, u.id,
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

/** Ocorrência do estafeta. Com «fail_delivery», regista tentativa falhada (o pedido nunca fica «entregue» assim). */
r.post('/orders/:id/incident', async (c) => {
  const u = requireRole(c, 'courier');
  const b = need<{ kind: string; description: string; fail_delivery?: boolean; photo_keys?: string[] }>(await c.req.json(), {
    kind: v.oneOf('acidente', 'destinatario_ausente', 'destinatario_recusa', 'morada_errada', 'volume_danificado', 'seguranca', 'outro'),
    description: v.str(3, 1000),
    fail_delivery: v.optBool(),
    photo_keys: photoList,
  });
  const o = await myOrder(c.env.DB, c.req.param('id'), u.id);
  const keys = await checkPhotoKeys(c.env.DB, b.photo_keys, proofPrefix(u.id), 0);
  const category = b.kind === 'volume_danificado' ? 'embalagem_danificada' : b.kind;
  const incidentId = uuid();
  const priority = b.kind === 'seguranca' || b.kind === 'acidente' ? 'urgente' : 'normal';
  const stmts = [
    incidentStmt(c.env.DB, incidentId, { orderId: o.id, reporterId: u.id, role: 'courier', category, description: b.description, priority }),
    ...evidenceStmts(c.env.DB, keys, { orderId: o.id, stage: 'incident', uploadedBy: u.id, incidentId }),
  ];
  if (b.fail_delivery && ['RECOLHIDO', 'EM_TRANSPORTE'].includes(o.status)) {
    const ok = await transition(c.env.DB, o, 'FALHA_ENTREGA', { id: u.id, role: 'courier' }, {
      requireCourier: u.id,
      note: `${INCIDENT_CATEGORIES[category] ?? b.kind}: ${b.description}`,
      extra: [...stmts, custodyStmt(c.env.DB, { orderId: o.id, type: 'entrega_falhada', from: courierParty(u.id), to: courierParty(u.id), actorId: u.id, metadata: { motivo: category } })],
    });
    if (!ok) throw conflict('estado_mudou', 'O pedido mudou entretanto.');
  } else {
    await c.env.DB.batch(stmts);
  }
  const inc = await one<{ protocol: string }>(c.env.DB, 'SELECT protocol FROM incidents WHERE id = ?', incidentId);
  return c.json({ ok: true, protocol: inc?.protocol }, 201);
});

r.post('/orders/:id/returned', async (c) => {
  const u = requireRole(c, 'courier');
  const o = await myOrder(c.env.DB, c.req.param('id'), u.id);
  const ok = await transition(c.env.DB, o, 'DEVOLVIDO', { id: u.id, role: 'courier' }, {
    requireCourier: u.id,
    note: 'Devolvido ao ponto de recolha',
    extra: [custodyStmt(c.env.DB, { orderId: o.id, type: 'devolucao_confirmada', from: courierParty(u.id), to: 'remetente', actorId: u.id })],
  });
  if (!ok) throw conflict('estado_mudou', 'O pedido mudou entretanto.');
  return c.json({ ok: true });
});

/** Foto de prova (opcional conforme política): devolve a chave privada a enviar na recolha/entrega. */
r.post('/proofs/upload', async (c) => {
  const u = requireRole(c, 'courier');
  const form = await c.req.formData();
  const file = form.get('file') as unknown as File | null;
  if (!file || typeof file.stream !== 'function' || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw bad('ficheiro', 'Envie uma foto JPG, PNG ou WEBP.');
  if (file.size > MAX_UPLOAD_BYTES) throw bad('ficheiro', 'A foto tem mais de 4 MB.');
  const key = `couriers/${u.id}/proofs/${uuid()}`;
  await files(c.env).put(key, await file.arrayBuffer(), file.type);
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
