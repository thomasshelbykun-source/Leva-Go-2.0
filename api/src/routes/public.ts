import { Hono } from 'hono';
import { ApiError, all, notFound, one, parseJson, type Env, type Vars } from '../lib/core.js';
import { STATUS_LABELS, type OrderStatus } from '../lib/domain.js';
import { rateLimit } from '../lib/services.js';

// Seguimento público: quem recebe o link vê o estado e a posição do estafeta, sem iniciar sessão.
// Não mostra morada de recolha, telefones, preço, código de entrega nem a rota completa.
const r = new Hono<{ Bindings: Env; Variables: Vars }>();

const LIVE: OrderStatus[] = ['ACEITE', 'RECOLHIDO', 'EM_TRANSPORTE'];
const FINAL: OrderStatus[] = ['ENTREGUE', 'CANCELADO', 'DEVOLVIDO'];
const round = (n: number) => Math.round(n * 1000) / 1000;

r.get('/track/:token', async (c) => {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  await rateLimit(c.env.DB, `track-ip:${ip}`, 120, 10);
  const token = c.req.param('token');
  if (!/^[\w-]{16,64}$/.test(token)) throw notFound('Link inválido.');
  const db = c.env.DB;
  const o = await one<{
    id: string; code: string; status: OrderStatus; service_type: string; dropoff_snapshot: string; assigned_courier_id: string | null; updated_at: string; quote_id: string;
  }>(db, 'SELECT id, code, status, service_type, dropoff_snapshot, assigned_courier_id, updated_at, quote_id FROM orders WHERE share_token = ?', token);
  if (!o) throw notFound('Link inválido.');
  // O link deixa de funcionar 3 dias depois de a encomenda terminar.
  if (FINAL.includes(o.status) && Date.now() - new Date(o.updated_at).getTime() > 3 * 86_400_000) throw new ApiError(410, 'link_expirado', 'Este link já expirou.');
  const drop = parseJson<{ lat: number; lon: number }>(o.dropoff_snapshot, null as never);
  let courier: { name: string; vehicle: string | null } | null = null;
  let location: { lat: number; lon: number; updated_at: string } | null = null;
  if (o.assigned_courier_id && LIVE.includes(o.status)) {
    courier = await one<{ name: string; vehicle: string | null }>(db, `SELECT u.name, v.kind AS vehicle FROM users u LEFT JOIN vehicles v ON v.courier_id = u.id AND v.status = 'approved' WHERE u.id = ? LIMIT 1`, o.assigned_courier_id);
    if (courier) courier.name = String(courier.name).split(' ')[0]!;
    location = await one<{ lat: number; lon: number; updated_at: string }>(db, 'SELECT lat, lon, updated_at FROM location_updates WHERE courier_id = ? AND order_id = ?', o.assigned_courier_id, o.id);
  }
  const quote = await one<{ estimated_duration_s: number }>(db, 'SELECT estimated_duration_s FROM quotes WHERE id = ?', o.quote_id);
  const events = await all<{ to_status: string; created_at: string }>(db, 'SELECT to_status, created_at FROM order_events WHERE order_id = ? ORDER BY created_at', o.id);
  return c.json({
    code: o.code,
    status: o.status,
    status_label: STATUS_LABELS[o.status],
    service_type: o.service_type,
    dropoff: drop ? { lat: round(drop.lat), lon: round(drop.lon) } : null,
    courier,
    courier_location: location,
    estimated_duration_s: quote?.estimated_duration_s ?? null,
    events,
  });
});

export default r;
