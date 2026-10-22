import { waitUntil } from '@vercel/functions';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { all, ApiError, getSetting, nowIso, one, parseJson, run, type Env, type Vars } from './lib/core.js';
import { getDb } from './lib/db.js';
import { fitsBusinessHours, type OrderStatus } from './lib/domain.js';
import { envFlags, loadHours, loadSession, notifyStmt, transition, type OrderRow } from './lib/services.js';
import admin from './routes/admin.js';
import auth from './routes/auth.js';
import courier from './routes/courier.js';
import customer from './routes/customer.js';
import payments from './routes/payments.js';

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

/** Configuração lida das variáveis de ambiente da Vercel (ou do ficheiro .env local). */
export function loadEnv(): Env {
  const e = process.env;
  return {
    DB: getDb(),
    ENVIRONMENT: e.ENVIRONMENT ?? 'staging',
    CORS_ORIGINS: e.CORS_ORIGINS ?? 'http://localhost:5173',
    CRON_SECRET: e.CRON_SECRET,
    // Serviços públicos de teste; troque por servidores próprios em produção.
    ROUTING_OSRM_URL: e.ROUTING_OSRM_URL ?? 'https://router.project-osrm.org',
    GEOCODER_URL: e.GEOCODER_URL ?? 'https://nominatim.openstreetmap.org',
    PAYMENTS_WEBHOOK_SECRET: e.PAYMENTS_WEBHOOK_SECRET,
    SMS_PROVIDER_URL: e.SMS_PROVIDER_URL,
    SMS_PROVIDER_KEY: e.SMS_PROVIDER_KEY,
  };
}

let lastHousekeeping = 0;

app.use('*', async (c, next) => {
  c.env = loadEnv();
  await next();
  // Limpeza periódica: corre no máximo uma vez a cada 15 minutos por instância, depois da resposta.
  if (Date.now() - lastHousekeeping > 15 * 60_000) {
    lastHousekeeping = Date.now();
    waitUntil(housekeeping(c.env).catch((err) => console.error('housekeeping', err)));
  }
});

app.use('*', async (c, next) => {
  const origins = c.env.CORS_ORIGINS.split(',').map((s) => s.trim());
  return cors({
    origin: (o) => (origins.includes(o) || /^https:\/\/levago(-[a-z0-9-]+)?\.vercel\.app$/.test(o) || o === 'capacitor://localhost' || o === 'https://localhost' ? o : origins[0]!),
    allowHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 600,
  })(c, next);
});

// Cabeçalhos de segurança e sessão.
app.use('*', async (c, next) => {
  const h = c.req.header('Authorization');
  if (h?.startsWith('Bearer ')) {
    const u = await loadSession(c.env.DB, h.slice(7));
    if (u) c.set('user', u);
  }
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  if (!c.res.headers.get('cache-control')) c.header('Cache-Control', 'no-store');
});

app.onError((err, c) => {
  if (err instanceof ApiError) return c.json({ error: err.code, message: err.message, details: err.details ?? null }, err.status as 400);
  if (err instanceof SyntaxError) return c.json({ error: 'json_invalido', message: 'Pedido mal formado.' }, 400);
  console.error(err);
  return c.json({ error: 'erro_interno', message: 'Ocorreu um erro. Tente de novo.' }, 500);
});

app.get('/', (c) => c.json({ service: 'levago-api', version: '2.0.0' }));

/** Configuração pública: versão mínima, horários, cobertura e modalidades (sem dados privados). */
app.get('/v1/config', async (c) => {
  const db = c.env.DB;
  const hours = await loadHours(db);
  const zones = await all<{ id: string; name: string; kind: string; polygon: string; city: string }>(db, 'SELECT id, name, kind, polygon, city FROM service_zones WHERE active = 1');
  const settings = Object.fromEntries((await all<{ key: string; value: string }>(db, "SELECT key, value FROM system_settings WHERE key IN ('company','limits','service_types','app','scheduling')")).map((s) => [s.key, parseJson(s.value, {})]));
  const pay = await getSetting(db, 'payments', { mpesa_enabled: false, emola_enabled: false, sandbox_enabled: true, pay_on_delivery_enabled: false, pay_on_delivery_max_cents: 0 });
  const pricing = await one<{ version: number }>(db, "SELECT version FROM pricing_versions WHERE status = 'published' ORDER BY version DESC LIMIT 1");
  const now = fitsBusinessHours(new Date(), 0, hours);
  return c.json({
    ...envFlags(c.env),
    ...settings,
    hours,
    open_now: now.ok,
    zones: zones.map((z) => ({ ...z, polygon: parseJson(z.polygon, []) })),
    payment_methods: {
      mpesa: pay.mpesa_enabled,
      emola: pay.emola_enabled,
      sandbox: pay.sandbox_enabled && c.env.ENVIRONMENT !== 'production',
      na_entrega: pay.pay_on_delivery_enabled,
    },
    pricing_published: !!pricing,
  });
});

/** Chamado pelo agendador da Vercel (vercel.json). A Vercel envia o CRON_SECRET no cabeçalho. */
app.get('/v1/internal/housekeeping', async (c) => {
  if (!c.env.CRON_SECRET || c.req.header('Authorization') !== `Bearer ${c.env.CRON_SECRET}`) throw new ApiError(401, 'sem_permissao', 'Sem permissão.');
  await housekeeping(c.env);
  return c.json({ ok: true });
});

app.route('/v1/auth', auth);
app.route('/v1', customer);
app.route('/v1/courier', courier);
app.route('/v1/payments', payments);
app.route('/v1/admin', admin);

app.notFound((c) => c.json({ error: 'nao_encontrado', message: 'Endereço inexistente.' }, 404));

/** Tarefas periódicas (cada 15 min): expira pedidos por pagar, cotações e subscrições. */
export async function housekeeping(env: Env) {
  const db = env.DB;
  const cutoff = new Date(Date.now() - 30 * 60_000).toISOString();
  const unpaid = await all<OrderRow>(db, "SELECT * FROM orders WHERE status = 'AGUARDA_PAGAMENTO' AND created_at < ?", cutoff);
  for (const o of unpaid) {
    const pending = await one(db, "SELECT 1 FROM payment_intents WHERE order_id = ? AND status = 'pending' AND created_at > ?", o.id, cutoff);
    if (pending) continue;
    await transition(db, o, 'CANCELADO' as OrderStatus, { id: null, role: 'system' }, { note: 'Pagamento não concluído em 30 minutos', set: { cancel_reason: 'Pagamento não concluído' } });
  }
  await run(db, "UPDATE payment_intents SET status = 'failed', failure_reason = 'Sem confirmação do provedor', updated_at = ? WHERE status = 'pending' AND created_at < ?", nowIso(), new Date(Date.now() - 60 * 60_000).toISOString());
  const ended = await all<{ id: string; customer_id: string }>(db, "SELECT id, customer_id FROM subscriptions WHERE status = 'active' AND current_period_end < ?", nowIso());
  for (const s of ended) {
    await db.batch([
      db.prepare("UPDATE subscriptions SET status = 'expired' WHERE id = ?").bind(s.id),
      notifyStmt(db, s.customer_id, `sub:${s.id}:expired`, 'subscricao', 'Subscrição terminou', 'O período terminou. Pode renovar em Planos.'),
    ]);
  }
  await run(db, 'DELETE FROM quotes WHERE used_at IS NULL AND expires_at < ?', new Date(Date.now() - 86_400_000).toISOString());
  await run(db, 'DELETE FROM rate_limits WHERE bucket < ?', new Date(Date.now() - 48 * 3_600_000).toISOString());
  await run(db, 'DELETE FROM sessions WHERE expires_at < ?', new Date(Date.now() - 7 * 86_400_000).toISOString());
}

export default app;

export { app };
