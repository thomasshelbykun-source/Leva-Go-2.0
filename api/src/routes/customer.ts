import type { Db, Stmt } from '../lib/db.js';
import { Hono } from 'hono';
import { reversePlace, roadRoute, searchPlaces, startCharge } from '../lib/adapters.js';
import {
  addMinutes, all, ApiError, bad, conflict, getSetting, need, normalizePhone, notFound, nowIso, one, parseJson, run, uuid, v,
  type Env, type Vars,
} from '../lib/core.js';
import { hashPassword, orderCode, randomDigits, randomToken, sha256, verifyPassword } from '../lib/crypto.js';
import {
  checkRoadDistance, checkWeight, coverageFor, customerCanCancel, fitsBusinessHours, priceFor, slotsForDay, STATUS_LABELS,
  type OrderStatus, type PricingRule,
} from '../lib/domain.js';
import { pushEnabled, pushPublicKey } from '../lib/push.js';
import { guardedBatch, loadHours, loadZones, notifyStmt, rateLimit, requireRole, transition, type OrderRow } from '../lib/services.js';

const r = new Hono<{ Bindings: Env; Variables: Vars }>();

// ------------------------------------------------------------------ Moradas e pesquisa
r.get('/places', async (c) => {
  requireRole(c, 'customer');
  const q = (c.req.query('q') ?? '').trim();
  if (q.length < 3) return c.json([]);
  return c.json(await searchPlaces(c.env, q));
});

r.get('/places/reverse', async (c) => {
  requireRole(c, 'customer');
  const lat = Number(c.req.query('lat'));
  const lon = Number(c.req.query('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw bad('coordenadas', 'Coordenadas inválidas.');
  const zones = await loadZones(c.env.DB);
  return c.json({ label: await reversePlace(c.env, lat, lon), coverage: coverageFor(lat, lon, zones) });
});

r.get('/addresses', async (c) => {
  const u = requireRole(c, 'customer');
  return c.json(await all(c.env.DB, 'SELECT * FROM customer_addresses WHERE user_id = ? ORDER BY created_at DESC', u.id));
});

r.post('/addresses', async (c) => {
  const u = requireRole(c, 'customer');
  const b = need<{ label: string; description: string; lat: number; lon: number }>(await c.req.json(), {
    label: v.str(1, 40), description: v.str(3, 300), lat: v.lat(), lon: v.lon(),
  });
  const id = uuid();
  await run(c.env.DB, 'INSERT INTO customer_addresses (id, user_id, label, description, lat, lon) VALUES (?,?,?,?,?,?)', id, u.id, b.label, b.description, b.lat, b.lon);
  return c.json({ id, ...b }, 201);
});

r.delete('/addresses/:id', async (c) => {
  const u = requireRole(c, 'customer');
  await run(c.env.DB, 'DELETE FROM customer_addresses WHERE id = ? AND user_id = ?', c.req.param('id'), u.id);
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ Hub do cliente
r.get('/home', async (c) => {
  const u = requireRole(c, 'customer');
  const active = await one(
    c.env.DB,
    "SELECT id, code, status, created_at FROM orders WHERE customer_id = ? AND status NOT IN ('ENTREGUE','CANCELADO','DEVOLVIDO') ORDER BY created_at DESC LIMIT 1",
    u.id,
  );
  const unread = await one<{ n: number }>(c.env.DB, 'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', u.id);
  const sub = await activeSubscription(c.env.DB, u.id);
  return c.json({ name: u.name, active_order: active, unread_notifications: unread?.n ?? 0, subscription: sub });
});

// ------------------------------------------------------------------ Agendamento
r.get('/slots', async (c) => {
  requireRole(c, 'customer');
  const date = c.req.query('date') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('data', 'Data inválida.');
  const cfg = await getSetting(c.env.DB, 'scheduling', { slot_minutes: 60, capacity_per_slot: 5, max_days_ahead: 7, min_lead_minutes: 60 });
  const today = new Date();
  const maxDate = new Date(today.getTime() + cfg.max_days_ahead * 86_400_000).toISOString().slice(0, 10);
  if (date > maxDate) return c.json({ slots: [], reason: `Só é possível agendar até ${cfg.max_days_ahead} dias à frente.` });
  const slots = slotsForDay(date, await loadHours(c.env.DB), cfg.slot_minutes, today, cfg.min_lead_minutes);
  const taken = await all<{ scheduled_at: string; n: number }>(
    c.env.DB,
    "SELECT scheduled_at, COUNT(*) AS n FROM orders WHERE scheduled_at BETWEEN ? AND ? AND status NOT IN ('CANCELADO') GROUP BY scheduled_at",
    slots[0]?.start ?? '',
    slots.at(-1)?.start ?? '',
  );
  const used = new Map(taken.map((t) => [t.scheduled_at, t.n]));
  return c.json({ slots: slots.map((s) => ({ ...s, available: (used.get(s.start) ?? 0) < cfg.capacity_per_slot })) });
});

// ------------------------------------------------------------------ Cotação
r.post('/quotes', async (c) => {
  const u = requireRole(c, 'customer');
  const b = need<{
    pickup: { lat: number; lon: number; text: string };
    dropoff: { lat: number; lon: number; text: string };
    weight_kg: number;
    service_type: 'normal' | 'expressa';
    scheduled_at?: string | null;
  }>(await c.req.json(), {
    pickup: point,
    dropoff: point,
    weight_kg: (x) => (typeof x === 'number' ? checkWeight(x) : 'Indique o peso.'),
    service_type: v.oneOf('normal', 'expressa'),
    scheduled_at: (x) => (x === undefined || x === null || (typeof x === 'string' && !Number.isNaN(Date.parse(x))) ? null : 'Data inválida.'),
  });
  await rateLimit(c.env.DB, `quote:${u.id}`, 30, 10);
  const limits = await getSetting(c.env.DB, 'limits', { max_weight_kg: 15, max_road_distance_m: 15000, quote_ttl_minutes: 10 });
  const types = await getSetting<Record<string, { enabled: boolean }>>(c.env.DB, 'service_types', {});
  if (types[b.service_type] && !types[b.service_type]!.enabled) throw bad('modalidade_indisponivel', 'Esta modalidade não está disponível agora.');

  const wErr = checkWeight(b.weight_kg, limits.max_weight_kg);
  if (wErr) throw bad('peso', wErr);

  const zones = await loadZones(c.env.DB);
  for (const [label, p] of [['recolha', b.pickup], ['destino', b.dropoff]] as const) {
    const cov = coverageFor(p.lat, p.lon, zones);
    if (!cov.ok) throw bad('fora_cobertura', `Local de ${label}: ${cov.reason}`);
  }

  const route = await roadRoute(c.env, b.pickup, b.dropoff);
  const dErr = checkRoadDistance(route.distance_m, limits.max_road_distance_m);
  if (dErr) throw bad('distancia', dErr);

  // Horário: agora (ou na hora agendada) mais a duração estimada tem de caber no turno.
  const start = b.scheduled_at ? new Date(b.scheduled_at) : new Date();
  if (b.scheduled_at && start.getTime() < Date.now()) throw bad('data_passada', 'Não é possível agendar no passado.');
  const hoursCheck = fitsBusinessHours(start, Math.ceil(route.duration_s / 60) + 20, await loadHours(c.env.DB));

  const pv = await one<{ id: string; version: number }>(c.env.DB, "SELECT id, version FROM pricing_versions WHERE status = 'published' ORDER BY version DESC LIMIT 1");
  if (!pv) throw new ApiError(503, 'sem_tarifa', 'Ainda não existe tabela de preços publicada. Não é possível cobrar.');
  const rule = await one<PricingRule>(c.env.DB, 'SELECT * FROM pricing_rules WHERE pricing_version_id = ? AND service_type = ?', pv.id, b.service_type);
  if (!rule) throw new ApiError(503, 'sem_tarifa', 'Não existe tarifa para esta modalidade.');
  const breakdown = priceFor(rule, route.distance_m, b.weight_kg);

  // Subscrição activa com benefício disponível cobre a entrega.
  const sub = await activeSubscription(c.env.DB, u.id);
  const covered = !!sub && sub.remaining > 0 && sub.service_types.includes(b.service_type) && b.weight_kg <= sub.max_weight_kg;
  if (covered) {
    breakdown.subscription_discount_cents = breakdown.total_cents;
    breakdown.total_cents = 0;
  }

  const id = uuid();
  const expires = addMinutes(new Date(), limits.quote_ttl_minutes).toISOString();
  await run(
    c.env.DB,
    `INSERT INTO quotes (id, customer_id, pickup_lat, pickup_lon, pickup_text, dropoff_lat, dropoff_lon, dropoff_text, weight_kg, service_type,
       road_distance_m, estimated_duration_s, route_provider, route_geometry, pricing_version_id, breakdown, total_cents, scheduled_at, expires_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, u.id, b.pickup.lat, b.pickup.lon, b.pickup.text, b.dropoff.lat, b.dropoff.lon, b.dropoff.text, b.weight_kg, b.service_type,
    route.distance_m, route.duration_s, route.provider, route.geometry ? JSON.stringify(route.geometry) : null, pv.id, JSON.stringify(breakdown),
    breakdown.total_cents, b.scheduled_at ?? null, expires,
  );
  return c.json({
    quote_id: id,
    road_distance_m: route.distance_m,
    estimated_duration_s: route.duration_s,
    route_geometry: route.geometry ?? null,
    breakdown,
    total_cents: breakdown.total_cents,
    total_mt: breakdown.total_cents / 100,
    currency: 'MZN',
    pricing_version: pv.version,
    covered_by_subscription: covered,
    service_available_now: hoursCheck.ok,
    hours_message: hoursCheck.ok ? null : hoursCheck.reason,
    expires_at: expires,
  });
});

const point = (x: unknown) => {
  const p = x as { lat?: unknown; lon?: unknown; text?: unknown };
  if (!p || typeof p !== 'object') return 'Escolha o local.';
  if (typeof p.lat !== 'number' || typeof p.lon !== 'number') return 'Escolha o local no mapa.';
  if (typeof p.text !== 'string' || p.text.trim().length < 3) return 'Descreva o local (rua, referência).';
  return null;
};

// ------------------------------------------------------------------ Encomendas
r.post('/orders', async (c) => {
  const u = requireRole(c, 'customer');
  const idem = c.req.header('Idempotency-Key');
  if (!idem || idem.length < 8 || idem.length > 80) throw bad('idempotencia', 'Falta o cabeçalho Idempotency-Key.');
  const b = need<{
    quote_id: string; recipient_name: string; recipient_phone: string; pickup_contact?: string; category: string; description: string; notes?: string;
    payment_method: 'mpesa' | 'emola' | 'na_entrega' | 'sandbox' | 'subscricao';
  }>(await c.req.json(), {
    quote_id: v.str(10, 64),
    recipient_name: v.str(2, 80),
    recipient_phone: v.phone(),
    pickup_contact: v.optStr(40),
    category: v.oneOf('documentos', 'roupa', 'comida', 'electronicos', 'medicamentos', 'compras', 'outro'),
    description: v.str(3, 300),
    notes: v.optStr(500),
    payment_method: v.oneOf('mpesa', 'emola', 'na_entrega', 'sandbox', 'subscricao'),
  });

  // Repetição do mesmo pedido devolve o pedido já criado (sem duplicar cobrança).
  const again = await one<{ id: string }>(c.env.DB, 'SELECT id FROM orders WHERE customer_id = ? AND idempotency_key = ?', u.id, idem);
  if (again) return c.json(await orderDetail(c.env.DB, again.id, u.id), 200);

  const q = await one<Record<string, unknown> & { id: string; total_cents: number; expires_at: string; used_at: string | null; breakdown: string; scheduled_at: string | null; weight_kg: number; service_type: string; road_distance_m: number; estimated_duration_s: number }>(
    c.env.DB, 'SELECT * FROM quotes WHERE id = ? AND customer_id = ?', b.quote_id, u.id,
  );
  if (!q) throw notFound('Cotação não encontrada.');
  if (q.used_at) throw conflict('cotacao_usada', 'Esta cotação já foi usada. Peça uma nova.');
  if (q.expires_at < nowIso()) throw bad('cotacao_expirada', 'A cotação expirou. Volte a pedir o preço.');

  // Revalidações no servidor (nunca confiar nos valores do cliente).
  const limits = await getSetting(c.env.DB, 'limits', { max_weight_kg: 15, max_road_distance_m: 15000, quote_ttl_minutes: 10 });
  const dErr = checkRoadDistance(q.road_distance_m, limits.max_road_distance_m) ?? checkWeight(q.weight_kg, limits.max_weight_kg);
  if (dErr) throw bad('limites', dErr);
  const start = q.scheduled_at ? new Date(q.scheduled_at) : new Date();
  const hours = fitsBusinessHours(start, Math.ceil(q.estimated_duration_s / 60) + 20, await loadHours(c.env.DB));
  if (!hours.ok) throw bad('fora_horario', `${hours.reason} Pode agendar a entrega para outro horário.`);
  if (q.scheduled_at) {
    const cfg = await getSetting(c.env.DB, 'scheduling', { slot_minutes: 60, capacity_per_slot: 5, max_days_ahead: 7, min_lead_minutes: 60 });
    const n = await one<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM orders WHERE scheduled_at = ? AND status <> 'CANCELADO'", q.scheduled_at);
    if ((n?.n ?? 0) >= cfg.capacity_per_slot) throw conflict('janela_cheia', 'Esta janela horária já está cheia. Escolha outra.');
  }

  const pay = await getSetting(c.env.DB, 'payments', { mpesa_enabled: false, emola_enabled: false, sandbox_enabled: true, pay_on_delivery_enabled: false, pay_on_delivery_max_cents: 0 });
  let status: OrderStatus;
  let paymentStatus: string;
  const extra: Stmt[] = [];
  const orderId = uuid();

  if (q.total_cents === 0) {
    const sub = await activeSubscription(c.env.DB, u.id);
    if (!sub || sub.remaining <= 0) throw bad('sem_beneficio', 'A subscrição já não tem entregas disponíveis. Peça nova cotação.');
    status = 'PENDENTE_ATRIBUICAO';
    paymentStatus = 'not_required';
    extra.push(
      c.env.DB.prepare('UPDATE subscription_entitlements SET deliveries_used = deliveries_used + 1 WHERE id = ? AND deliveries_used < deliveries_total').bind(sub.entitlement_id),
      c.env.DB.prepare('INSERT INTO entitlement_usages (order_id, entitlement_id) VALUES (?,?)').bind(orderId, sub.entitlement_id),
    );
  } else if (b.payment_method === 'na_entrega') {
    if (!pay.pay_on_delivery_enabled || q.total_cents > pay.pay_on_delivery_max_cents) {
      throw bad('na_entrega_indisponivel', 'O pagamento na entrega não está disponível para este pedido.');
    }
    status = 'PENDENTE_ATRIBUICAO';
    paymentStatus = 'collect_on_delivery';
  } else {
    const enabled = { mpesa: pay.mpesa_enabled, emola: pay.emola_enabled, sandbox: pay.sandbox_enabled && c.env.ENVIRONMENT !== 'production', subscricao: false } as Record<string, boolean>;
    if (!enabled[b.payment_method]) throw bad('metodo_indisponivel', 'Este método de pagamento ainda não está disponível.');
    status = 'AGUARDA_PAGAMENTO';
    paymentStatus = 'pending';
  }

  const deliveryCode = randomDigits(4);
  const code = orderCode();
  const insert = c.env.DB.prepare(
    `INSERT INTO orders (id, code, customer_id, quote_id, idempotency_key, pickup_snapshot, dropoff_snapshot, recipient_name, recipient_phone,
       category, description, notes, weight_kg, service_type, road_distance_m, price_cents, pricing_snapshot, payment_method, payment_status, status,
       scheduled_at, delivery_code_hash)
     SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM quotes WHERE id = ? AND used_at IS NOT NULL)`,
  ).bind(
    orderId, code, u.id, q.id, idem,
    JSON.stringify({ text: q.pickup_text, lat: q.pickup_lat, lon: q.pickup_lon, contact: b.pickup_contact ?? null }),
    JSON.stringify({ text: q.dropoff_text, lat: q.dropoff_lat, lon: q.dropoff_lon }),
    b.recipient_name, normalizePhone(b.recipient_phone), b.category, b.description, b.notes ?? null, q.weight_kg, q.service_type,
    q.road_distance_m, q.total_cents, q.breakdown, q.total_cents === 0 ? 'subscricao' : b.payment_method,
    paymentStatus, status, q.scheduled_at, await sha256(`${orderId}:${deliveryCode}`), q.id,
  );
  const ok = await guardedBatch(c.env.DB, insert, [
    c.env.DB.prepare('UPDATE quotes SET used_at = ? WHERE id = ?').bind(nowIso(), q.id),
    c.env.DB.prepare("INSERT INTO order_events (id, order_id, from_status, to_status, actor_id, actor_role, note) VALUES (?,?,NULL,?,?, 'customer', 'Pedido criado')").bind(uuid(), orderId, status, u.id),
    ...extra,
    notifyStmt(c.env.DB, u.id, `order:${orderId}:created`, 'encomenda', `${code}: pedido criado`, `Código de entrega: ${deliveryCode}. Mostre-o só ao estafeta, no momento da entrega.`, orderId),
  ]);
  if (!ok) throw conflict('cotacao_usada', 'Esta cotação já foi usada. Peça uma nova.');
  // O código de entrega é mostrado uma vez ao cliente e fica guardado só como hash.
  return c.json({ ...(await orderDetail(c.env.DB, orderId, u.id)), delivery_code: deliveryCode }, 201);
});

r.get('/orders', async (c) => {
  const u = requireRole(c, 'customer');
  const filter = c.req.query('filter') ?? 'todas';
  const page = Math.max(1, Number(c.req.query('page') ?? 1));
  const where: Record<string, string> = {
    todas: '',
    em_curso: "AND status NOT IN ('ENTREGUE','CANCELADO','DEVOLVIDO')",
    concluidas: "AND status IN ('ENTREGUE','DEVOLVIDO')",
    canceladas: "AND status = 'CANCELADO'",
  };
  const rows = await all(
    c.env.DB,
    `SELECT id, code, status, price_cents, service_type, created_at, scheduled_at, dropoff_snapshot, pickup_snapshot,
            EXISTS (SELECT 1 FROM ratings WHERE ratings.order_id = orders.id) AS rated
       FROM orders WHERE customer_id = ? ${where[filter] ?? ''} ORDER BY created_at DESC LIMIT 20 OFFSET ?`,
    u.id,
    (page - 1) * 20,
  );
  return c.json({ page, items: rows.map((o) => ({ ...o, status_label: STATUS_LABELS[o.status as OrderStatus], pickup: parseJson(o.pickup_snapshot, {}), dropoff: parseJson(o.dropoff_snapshot, {}) })) });
});

r.get('/orders/:id', async (c) => {
  const u = requireRole(c, 'customer');
  return c.json(await orderDetail(c.env.DB, c.req.param('id'), u.id));
});

/** Cria (ou devolve) o código do link público de seguimento, para partilhar por WhatsApp. */
r.post('/orders/:id/share', async (c) => {
  const u = requireRole(c, 'customer');
  const o = await one<{ id: string; share_token: string | null; status: string }>(c.env.DB, 'SELECT id, share_token, status FROM orders WHERE id = ? AND customer_id = ?', c.req.param('id'), u.id);
  if (!o) throw notFound('Encomenda não encontrada.');
  let token = o.share_token;
  if (!token) {
    token = randomToken(16);
    await run(c.env.DB, 'UPDATE orders SET share_token = ? WHERE id = ? AND share_token IS NULL', token, o.id);
    token = (await one<{ share_token: string }>(c.env.DB, 'SELECT share_token FROM orders WHERE id = ?', o.id))!.share_token;
  }
  return c.json({ token });
});

r.post('/orders/:id/cancel', async (c) => {
  const u = requireRole(c, 'customer');
  const b = need<{ reason: string }>(await c.req.json(), { reason: v.str(3, 300) });
  const o = await one<OrderRow>(c.env.DB, 'SELECT * FROM orders WHERE id = ? AND customer_id = ?', c.req.param('id'), u.id);
  if (!o) throw notFound();
  if (!customerCanCancel(o.status)) throw conflict('cancelamento_indisponivel', 'O pedido já não pode ser cancelado pela app. Fale com o apoio.');
  const extra: Stmt[] = [];
  // Benefício da subscrição volta a estar disponível.
  extra.push(
    c.env.DB.prepare('UPDATE subscription_entitlements SET deliveries_used = deliveries_used - 1 WHERE id = (SELECT entitlement_id FROM entitlement_usages WHERE order_id = ?) AND deliveries_used > 0').bind(o.id),
    c.env.DB.prepare('DELETE FROM entitlement_usages WHERE order_id = ?').bind(o.id),
  );
  // Pagamento confirmado gera pedido de reembolso para o Admin aprovar (política pendente 14.2).
  if (o.payment_status === 'succeeded') {
    extra.push(c.env.DB.prepare(
      "INSERT INTO refunds (id, intent_id, amount_cents, reason, requested_by) SELECT ?, id, amount_cents, ?, ? FROM payment_intents WHERE order_id = ? AND status = 'succeeded' LIMIT 1",
    ).bind(uuid(), `Cancelamento pelo cliente: ${b.reason}`, u.id, o.id));
  }
  const ok = await transition(c.env.DB, o, 'CANCELADO', { id: u.id, role: 'customer' }, { note: b.reason, set: { cancel_reason: b.reason }, extra });
  if (!ok) throw conflict('estado_mudou', 'O pedido mudou entretanto. Actualize a página.');
  return c.json(await orderDetail(c.env.DB, o.id, u.id));
});

r.post('/orders/:id/rating', async (c) => {
  const u = requireRole(c, 'customer');
  const b = need<{ stars: number; comment?: string }>(await c.req.json(), { stars: v.int(1, 5), comment: v.optStr(500) });
  const o = await one<OrderRow>(c.env.DB, "SELECT * FROM orders WHERE id = ? AND customer_id = ? AND status = 'ENTREGUE'", c.req.param('id'), u.id);
  if (!o) throw bad('avaliacao', 'Só pode avaliar encomendas entregues.');
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO ratings (order_id, courier_id, stars, comment) VALUES (?,?,?,?) ON CONFLICT DO NOTHING').bind(o.id, o.assigned_courier_id, b.stars, b.comment ?? null),
    c.env.DB.prepare(
      `UPDATE courier_profiles SET rating_count = (SELECT COUNT(*) FROM ratings WHERE courier_id = ?), rating_avg = (SELECT AVG(stars) FROM ratings WHERE courier_id = ?) WHERE user_id = ?`,
    ).bind(o.assigned_courier_id, o.assigned_courier_id, o.assigned_courier_id),
  ]);
  return c.json({ ok: true });
});

/** Comprovativo simples (texto) para guardar ou partilhar. */
r.get('/orders/:id/receipt', async (c) => {
  const u = requireRole(c, 'customer');
  const o = await orderDetail(c.env.DB, c.req.param('id'), u.id);
  return c.json({
    company: 'LevaGo',
    code: o.code,
    created_at: o.created_at,
    status: o.status_label,
    service_type: o.service_type,
    road_distance_km: Number(o.road_distance_m) / 1000,
    weight_kg: o.weight_kg,
    price_mt: Number(o.price_cents) / 100,
    payment_method: o.payment_method,
    payment_status: o.payment_status,
    pickup: o.pickup.text,
    dropoff: o.dropoff.text,
  });
});

async function orderDetail(db: Db, id: string, customerId: string): Promise<Record<string, any>> {
  const o = await one<Record<string, any> & { status: OrderStatus; assigned_courier_id: string | null; quote_id: string }>(
    db,
    `SELECT id, code, status, customer_id, quote_id, pickup_snapshot, dropoff_snapshot, recipient_name, recipient_phone, category, description, notes,
            weight_kg, service_type, road_distance_m, price_cents, pricing_snapshot, payment_method, payment_status, scheduled_at, assigned_courier_id,
            cancel_reason, created_at, updated_at
       FROM orders WHERE id = ? AND customer_id = ?`,
    id,
    customerId,
  );
  if (!o) throw notFound('Encomenda não encontrada.');
  const events = await all(db, 'SELECT to_status, note, created_at FROM order_events WHERE order_id = ? ORDER BY created_at', id);
  const quote = await one<{ route_geometry: string | null; estimated_duration_s: number }>(db, 'SELECT route_geometry, estimated_duration_s FROM quotes WHERE id = ?', o.quote_id);
  let courier = null;
  let location = null;
  // Identificação mínima do estafeta e posição só enquanto a entrega está activa.
  if (o.assigned_courier_id && ['ATRIBUIDO', 'ACEITE', 'RECOLHIDO', 'EM_TRANSPORTE'].includes(o.status)) {
    courier = await one(
      db,
      `SELECT u.name, v.kind AS vehicle, p.rating_avg FROM users u JOIN courier_profiles p ON p.user_id = u.id
         LEFT JOIN vehicles v ON v.courier_id = u.id AND v.status = 'approved' WHERE u.id = ? LIMIT 1`,
      o.assigned_courier_id,
    );
    if (courier) (courier as Record<string, unknown>).name = String((courier as { name: string }).name).split(' ')[0];
    if (['ACEITE', 'RECOLHIDO', 'EM_TRANSPORTE'].includes(o.status)) {
      location = await one(db, 'SELECT lat, lon, updated_at FROM location_updates WHERE courier_id = ? AND order_id = ?', o.assigned_courier_id, id);
    }
  }
  const payment = await one(db, 'SELECT id, provider, status, amount_cents, failure_reason FROM payment_intents WHERE order_id = ? ORDER BY created_at DESC LIMIT 1', id);
  const rating = await one(db, 'SELECT stars, comment FROM ratings WHERE order_id = ?', id);
  return {
    ...o,
    status_label: STATUS_LABELS[o.status],
    pickup: parseJson<{ text: string; lat: number; lon: number }>(o.pickup_snapshot, null as never),
    dropoff: parseJson<{ text: string; lat: number; lon: number }>(o.dropoff_snapshot, null as never),
    pricing: parseJson(o.pricing_snapshot, {}),
    route_geometry: parseJson(quote?.route_geometry, null),
    estimated_duration_s: quote?.estimated_duration_s ?? null,
    can_cancel: customerCanCancel(o.status),
    events,
    courier,
    courier_location: location,
    payment,
    rating,
    pickup_snapshot: undefined,
    dropoff_snapshot: undefined,
    pricing_snapshot: undefined,
    assigned_courier_id: undefined,
  };
}

// ------------------------------------------------------------------ Pagamentos (cliente)
r.post('/payments/intents', async (c) => {
  const u = requireRole(c, 'customer');
  const b = need<{ order_id?: string; subscription_id?: string; provider: 'mpesa' | 'emola' | 'sandbox'; msisdn: string }>(await c.req.json(), {
    order_id: v.optStr(64), subscription_id: v.optStr(64), provider: v.oneOf('mpesa', 'emola', 'sandbox'), msisdn: v.phone(),
  });
  const idem = c.req.header('Idempotency-Key');
  if (!idem) throw bad('idempotencia', 'Falta o cabeçalho Idempotency-Key.');
  const existing = await one(c.env.DB, 'SELECT * FROM payment_intents WHERE idempotency_key = ? AND customer_id = ?', idem, u.id);
  if (existing) return c.json(existing);

  let amount = 0;
  if (b.order_id) {
    const o = await one<OrderRow>(c.env.DB, "SELECT * FROM orders WHERE id = ? AND customer_id = ?", b.order_id, u.id);
    if (!o) throw notFound();
    if (o.status !== 'AGUARDA_PAGAMENTO') throw conflict('pagamento_desnecessario', 'Este pedido já não aguarda pagamento.');
    // Evita dupla cobrança: só uma tentativa pendente ou paga por pedido.
    const open = await one(c.env.DB, "SELECT id FROM payment_intents WHERE order_id = ? AND status IN ('pending','succeeded')", o.id);
    if (open) throw conflict('pagamento_em_curso', 'Já existe um pagamento em curso para este pedido. Aguarde a confirmação.');
    amount = o.price_cents;
  } else if (b.subscription_id) {
    const s = await one<{ id: string; status: string; plan_snapshot: string }>(c.env.DB, 'SELECT * FROM subscriptions WHERE id = ? AND customer_id = ?', b.subscription_id, u.id);
    if (!s || s.status !== 'pending_payment') throw conflict('pagamento_desnecessario', 'Esta subscrição não aguarda pagamento.');
    const open = await one(c.env.DB, "SELECT id FROM payment_intents WHERE subscription_id = ? AND status IN ('pending','succeeded')", s.id);
    if (open) throw conflict('pagamento_em_curso', 'Já existe um pagamento em curso para esta subscrição.');
    amount = parseJson<{ price_cents: number }>(s.plan_snapshot, { price_cents: 0 }).price_cents;
  } else throw bad('pagamento', 'Indique o pedido ou a subscrição.');

  const id = uuid();
  const msisdn = normalizePhone(b.msisdn)!;
  const charge = await startCharge(c.env, b.provider, { id, amount_cents: amount, msisdn });
  await run(
    c.env.DB,
    'INSERT INTO payment_intents (id, customer_id, order_id, subscription_id, provider, amount_cents, msisdn, provider_ref, idempotency_key) VALUES (?,?,?,?,?,?,?,?,?)',
    id, u.id, b.order_id ?? null, b.subscription_id ?? null, b.provider, amount, msisdn, charge.provider_ref, idem,
  );
  return c.json(await one(c.env.DB, 'SELECT id, provider, status, amount_cents, provider_ref, created_at FROM payment_intents WHERE id = ?', id), 201);
});

r.get('/payments/intents/:id', async (c) => {
  const u = requireRole(c, 'customer');
  const pi = await one(c.env.DB, 'SELECT id, provider, status, amount_cents, failure_reason, order_id, subscription_id FROM payment_intents WHERE id = ? AND customer_id = ?', c.req.param('id'), u.id);
  if (!pi) throw notFound();
  return c.json(pi);
});

// ------------------------------------------------------------------ Subscrições
async function activeSubscription(db: Db, customerId: string) {
  const s = await one<{ id: string; plan_snapshot: string; current_period_end: string; auto_renew: number; entitlement_id: string; total: number; used: number }>(
    db,
    `SELECT s.id, s.plan_snapshot, s.current_period_end, s.auto_renew, e.id AS entitlement_id, e.deliveries_total AS total, e.deliveries_used AS used
       FROM subscriptions s JOIN subscription_entitlements e ON e.subscription_id = s.id AND e.period_start = s.current_period_start
      WHERE s.customer_id = ? AND s.status = 'active' AND s.current_period_end > ? LIMIT 1`,
    customerId,
    nowIso(),
  );
  if (!s) return null;
  const plan = parseJson<{ name: string; service_types: string[]; max_weight_kg: number }>(s.plan_snapshot, { name: '', service_types: [], max_weight_kg: 15 });
  return {
    id: s.id, plan_name: plan.name, service_types: plan.service_types, max_weight_kg: plan.max_weight_kg,
    period_end: s.current_period_end, auto_renew: !!s.auto_renew, entitlement_id: s.entitlement_id,
    used: s.used, total: s.total, remaining: s.total - s.used,
  };
}

r.get('/plans', async (c) => {
  const u = requireRole(c, 'customer');
  const plans = await all(c.env.DB, "SELECT id, name, description, price_cents, period_days, deliveries_included, max_weight_kg, service_types FROM subscription_plans WHERE status = 'published' ORDER BY price_cents");
  const subs = await all(c.env.DB, 'SELECT id, plan_id, status, plan_snapshot, current_period_end, auto_renew, created_at FROM subscriptions WHERE customer_id = ? ORDER BY created_at DESC LIMIT 10', u.id);
  return c.json({
    plans: plans.map((p) => ({ ...p, service_types: parseJson(p.service_types, []) })),
    active: await activeSubscription(c.env.DB, u.id),
    history: subs.map((s) => ({ ...s, plan_snapshot: parseJson(s.plan_snapshot, {}) })),
  });
});

r.post('/subscriptions', async (c) => {
  const u = requireRole(c, 'customer');
  const b = need<{ plan_id: string }>(await c.req.json(), { plan_id: v.str(10, 64) });
  const plan = await one<Record<string, unknown>>(c.env.DB, "SELECT * FROM subscription_plans WHERE id = ? AND status = 'published'", b.plan_id);
  if (!plan) throw notFound('Plano não disponível.');
  if (await activeSubscription(c.env.DB, u.id)) throw conflict('ja_subscrito', 'Já tem uma subscrição activa.');
  await run(c.env.DB, "UPDATE subscriptions SET status = 'cancelled', cancelled_at = ? WHERE customer_id = ? AND status = 'pending_payment'", nowIso(), u.id);
  const id = uuid();
  const snapshot = {
    name: plan.name, price_cents: plan.price_cents, period_days: plan.period_days, deliveries_included: plan.deliveries_included,
    max_weight_kg: plan.max_weight_kg, service_types: parseJson(plan.service_types, ['normal']),
  };
  await run(c.env.DB, 'INSERT INTO subscriptions (id, customer_id, plan_id, plan_snapshot) VALUES (?,?,?,?)', id, u.id, b.plan_id, JSON.stringify(snapshot));
  return c.json({ id, status: 'pending_payment', amount_cents: plan.price_cents }, 201);
});

r.post('/subscriptions/:id/cancel', async (c) => {
  const u = requireRole(c, 'customer');
  // Cancelar desliga a renovação; os benefícios do período pago continuam até ao fim.
  const res = await run(c.env.DB, "UPDATE subscriptions SET auto_renew = 0, cancelled_at = ? WHERE id = ? AND customer_id = ? AND status = 'active'", nowIso(), c.req.param('id'), u.id);
  if (!res.meta.changes) throw notFound('Subscrição activa não encontrada.');
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ Notificações
r.get('/notifications', async (c) => {
  const u = requireRole(c, 'customer', 'courier');
  return c.json(await all(c.env.DB, 'SELECT id, category, title, body, order_id, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100', u.id));
});

r.post('/notifications/read', async (c) => {
  const u = requireRole(c, 'customer', 'courier');
  const b = (await c.req.json().catch(() => ({}))) as { ids?: string[] };
  if (Array.isArray(b.ids) && b.ids.length) {
    const ids = b.ids.slice(0, 100);
    await run(c.env.DB, `UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`, nowIso(), u.id, ...ids);
  } else {
    await run(c.env.DB, 'UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', nowIso(), u.id);
  }
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ Notificações push
r.get('/push/key', (c) => c.json({ enabled: pushEnabled(), public_key: pushPublicKey() }));

r.post('/push/subscribe', async (c) => {
  const u = requireRole(c, 'customer', 'courier');
  const b = (await c.req.json()) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const endpoint = typeof b.endpoint === 'string' ? b.endpoint : '';
  const p256dh = typeof b.keys?.p256dh === 'string' ? b.keys.p256dh : '';
  const auth = typeof b.keys?.auth === 'string' ? b.keys.auth : '';
  if (!/^https:\/\/[^\s]{10,500}$/.test(endpoint) || p256dh.length < 40 || p256dh.length > 120 || auth.length < 10 || auth.length > 40) throw bad('subscricao', 'Subscrição inválida.');
  await run(
    c.env.DB,
    'INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth) VALUES (?,?,?,?,?) ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth',
    uuid(), u.id, endpoint, p256dh, auth,
  );
  return c.json({ ok: true });
});

r.post('/push/unsubscribe', async (c) => {
  const u = requireRole(c, 'customer', 'courier');
  const b = (await c.req.json().catch(() => ({}))) as { endpoint?: unknown };
  if (typeof b.endpoint === 'string') await run(c.env.DB, 'DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?', b.endpoint, u.id);
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ Perfil e definições (cliente e estafeta)
r.patch('/profile', async (c) => {
  const u = requireRole(c, 'customer', 'courier');
  const b = (await c.req.json()) as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  if (b.name !== undefined) { if (v.str(2, 80)(b.name)) throw bad('nome', 'Nome inválido.'); fields.name = String(b.name).trim(); }
  if (b.email !== undefined) {
    if (b.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(b.email))) throw bad('email', 'Email inválido.');
    fields.email = b.email || null;
  }
  if (b.locale !== undefined) { if (!['pt-MZ', 'en'].includes(String(b.locale))) throw bad('idioma', 'Idioma inválido.'); fields.locale = b.locale; }
  if (b.theme !== undefined) { if (!['system', 'light', 'dark'].includes(String(b.theme))) throw bad('tema', 'Tema inválido.'); fields.theme = b.theme; }
  if (b.notify_prefs !== undefined) fields.notify_prefs = JSON.stringify({ orders: true, promos: !!(b.notify_prefs as { promos?: boolean })?.promos });
  if (!Object.keys(fields).length) return c.json({ ok: true });
  fields.updated_at = nowIso();
  await run(c.env.DB, `UPDATE users SET ${Object.keys(fields).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...Object.values(fields), u.id);
  return c.json({ ok: true });
});

r.post('/profile/password', async (c) => {
  const u = requireRole(c, 'customer', 'courier');
  const b = need<{ current: string; next: string }>(await c.req.json(), { current: v.str(1, 128), next: (x) => (await_pw(x)) });
  const row = await one<{ password_hash: string }>(c.env.DB, 'SELECT password_hash FROM users WHERE id = ?', u.id);
  if (!row || !(await verifyPassword(b.current, row.password_hash))) throw bad('senha', 'A palavra-passe actual está errada.');
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').bind(await hashPassword(b.next), nowIso(), u.id),
    c.env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL').bind(nowIso(), u.id, u.sessionId),
  ]);
  return c.json({ ok: true });
});
const await_pw = (x: unknown) => (typeof x === 'string' && x.length >= 8 && /[A-Za-z]/.test(x) && /\d/.test(x) ? null : 'Use 8 ou mais caracteres, com letras e números.');

/** Eliminação de conta: exige palavra-passe; o pedido fica para processamento segundo a retenção legal. */
r.post('/account/delete', async (c) => {
  const u = requireRole(c, 'customer', 'courier');
  const b = need<{ password: string; reason?: string }>(await c.req.json(), { password: v.str(1, 128), reason: v.optStr(300) });
  const row = await one<{ password_hash: string }>(c.env.DB, 'SELECT password_hash FROM users WHERE id = ?', u.id);
  if (!row || !(await verifyPassword(b.password, row.password_hash))) throw bad('senha', 'Palavra-passe incorrecta.');
  const active = await one(c.env.DB, "SELECT 1 FROM orders WHERE (customer_id = ? OR assigned_courier_id = ?) AND status NOT IN ('ENTREGUE','CANCELADO','DEVOLVIDO')", u.id, u.id);
  if (active) throw conflict('pedido_activo', 'Termine ou cancele as encomendas em curso antes de eliminar a conta.');
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO account_deletion_requests (id, user_id, reason) VALUES (?,?,?)').bind(uuid(), u.id, b.reason ?? null),
    c.env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').bind(nowIso(), u.id),
  ]);
  return c.json({ ok: true, message: 'Pedido de eliminação registado. A sessão foi terminada.' });
});

// ------------------------------------------------------------------ Apoio (cliente e estafeta)
r.get('/support', async (c) => {
  const u = requireRole(c, 'customer', 'courier');
  return c.json(await all(c.env.DB, 'SELECT id, subject, status, priority, order_id, created_at, updated_at FROM support_tickets WHERE opened_by = ? ORDER BY updated_at DESC', u.id));
});

r.post('/support', async (c) => {
  const u = requireRole(c, 'customer', 'courier');
  const b = need<{ subject: string; message: string; order_id?: string }>(await c.req.json(), { subject: v.str(3, 120), message: v.str(3, 2000), order_id: v.optStr(64) });
  await rateLimit(c.env.DB, `ticket:${u.id}`, 10, 60);
  if (b.order_id) {
    const own = await one(c.env.DB, 'SELECT 1 FROM orders WHERE id = ? AND (customer_id = ? OR assigned_courier_id = ?)', b.order_id, u.id, u.id);
    if (!own) throw notFound('Encomenda não encontrada.');
  }
  const id = uuid();
  const role = u.app === 'estafeta' ? 'courier' : 'customer';
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO support_tickets (id, opened_by, opener_role, order_id, subject, sla_due_at) VALUES (?,?,?,?,?,?)').bind(id, u.id, role, b.order_id ?? null, b.subject, addMinutes(new Date(), 24 * 60).toISOString()),
    c.env.DB.prepare('INSERT INTO ticket_messages (id, ticket_id, author_id, body) VALUES (?,?,?,?)').bind(uuid(), id, u.id, b.message),
  ]);
  return c.json({ id }, 201);
});

r.get('/support/:id', async (c) => {
  const u = requireRole(c, 'customer', 'courier');
  const t = await one(c.env.DB, 'SELECT * FROM support_tickets WHERE id = ? AND opened_by = ?', c.req.param('id'), u.id);
  if (!t) throw notFound();
  const msgs = await all(c.env.DB, 'SELECT m.id, m.body, m.created_at, m.author_id = ? AS mine FROM ticket_messages m WHERE ticket_id = ? AND internal = 0 ORDER BY created_at', u.id, c.req.param('id'));
  return c.json({ ...t, messages: msgs });
});

r.post('/support/:id/messages', async (c) => {
  const u = requireRole(c, 'customer', 'courier');
  const b = need<{ body: string }>(await c.req.json(), { body: v.str(1, 2000) });
  const t = await one<{ status: string }>(c.env.DB, 'SELECT status FROM support_tickets WHERE id = ? AND opened_by = ?', c.req.param('id'), u.id);
  if (!t) throw notFound();
  if (t.status === 'fechado') throw conflict('fechado', 'Este caso está fechado. Abra um novo.');
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO ticket_messages (id, ticket_id, author_id, body) VALUES (?,?,?,?)').bind(uuid(), c.req.param('id'), u.id, b.body),
    c.env.DB.prepare("UPDATE support_tickets SET updated_at = ?, status = CASE WHEN status = 'resolvido' THEN 'aberto' ELSE status END WHERE id = ?").bind(nowIso(), c.req.param('id')),
  ]);
  return c.json({ ok: true }, 201);
});

export default r;
