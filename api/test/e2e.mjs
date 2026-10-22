// Teste ponta a ponta (especificação, secção 12): registo Cliente → cotação → pagamento sandbox →
// aprovação de estafeta pelo Admin → aceite atómico → recolha → entrega com código → recibo e histórico.
// Corre a API real com uma base Postgres nova e temporária.
// Uso: TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm run test:e2e
import { spawn, execFileSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import pg from 'pg';

const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}/v1`;
const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/postgres';
const DB_NAME = `levago_e2e_${randomBytes(4).toString('hex')}`;
const dbUrl = (() => { const u = new URL(ADMIN_URL); u.pathname = `/${DB_NAME}`; return u.toString(); })();
const adminSql = async (url, sql) => { const c = new pg.Client({ connectionString: url }); c.on('error', () => {}); await c.connect(); try { return await c.query(sql); } finally { await c.end(); } };

let failures = 0;
const ok = (cond, msg) => {
  if (cond) console.log(`  ✓ ${msg}`);
  else { failures++; console.log(`  ✗ ${msg}`); }
};

async function api(method, path, { token, body, idem, form } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (idem) headers['idempotency-key'] = idem;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: form ?? (body ? JSON.stringify(body) : undefined) });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

async function register(name, phone, app = 'cliente') {
  const s = await api('POST', '/auth/register/start', { body: { name, phone, password: 'segredo123', consent_terms: true, consent_privacy: true, app } });
  if (s.status !== 200) throw new Error(`register/start ${s.status} ${JSON.stringify(s.data)}`);
  const v = await api('POST', '/auth/register/verify', { body: { verification_id: s.data.verification_id, code: s.data.dev_code } });
  if (v.status !== 201) throw new Error(`register/verify ${v.status} ${JSON.stringify(v.data)}`);
  return v.data;
}
const login = async (phone, app) => (await api('POST', '/auth/login', { body: { phone, password: 'segredo123', app } })).data.token;

async function main() {
  console.log('Preparar base de dados local…');
  await adminSql(ADMIN_URL, `CREATE DATABASE ${DB_NAME}`);
  execFileSync('npx', ['tsx', 'scripts/migrate.ts', '--seed'], { stdio: 'pipe', env: { ...process.env, DATABASE_URL: dbUrl } });

  const dev = spawn('npx', ['tsx', 'scripts/dev.ts'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    env: { ...process.env, DATABASE_URL: dbUrl, PORT: String(PORT), ENVIRONMENT: 'test', PAYMENTS_WEBHOOK_SECRET: 'segredo-teste', CORS_ORIGINS: 'http://localhost:5173' },
  });
  let log = '';
  dev.stdout.on('data', (d) => (log += d));
  dev.stderr.on('data', (d) => (log += d));
  try {
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) break; } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }

    console.log('Contas e papéis');
    const adm = await register('Ana Admin', '841000001');
    await adminSql(dbUrl, `INSERT INTO user_roles (user_id, role) VALUES ('${adm.user.id}','super_admin'),('${adm.user.id}','admin')`);
    const adminToken = await login('841000001', 'admin');
    ok(!!adminToken, 'super-admin entra no painel');
    const adm2 = await register('Bruno Admin', '841000002');
    ok((await api('POST', '/admin/admins', { token: adminToken, body: { phone: '841000002', role: 'admin', grant: true, reason: 'Segundo administrador' } })).status === 200, 'super-admin cria segundo admin');
    const admin2Token = await login('841000002', 'admin');
    ok((await api('POST', '/admin/admins', { token: admin2Token, body: { phone: '841000002', role: 'super_admin', grant: true, reason: 'auto' } })).status === 403, 'admin não se atribui privilégios');

    const cli = await register('Carla Cliente', '842000001');
    ok((await api('POST', '/auth/login', { body: { phone: '842000001', password: 'segredo123', app: 'admin' } })).status === 401, 'cliente não entra no painel admin');
    ok((await api('GET', '/admin/orders', { token: cli.token })).status === 403, 'cliente não acede a rotas admin');
    const dup = await api('POST', '/auth/register/start', { body: { name: 'Xavier', phone: '842000001', password: 'segredo123', consent_terms: true, consent_privacy: true, app: 'cliente' } });
    ok(dup.status === 200 && !dup.data.dev_code, 'registo duplicado não revela a conta nem envia código');

    // Horário 24h para o teste não depender da hora a que corre.
    const allDay = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ weekday: d, opens_at: '00:00', closes_at: '23:59' }));
    ok((await api('PUT', '/admin/hours', { token: adminToken, body: { hours: allDay, reason: 'Teste automático' } })).status === 200, 'admin altera horário (auditado)');

    console.log('Cotação (BR-01, BR-02, BR-04)');
    const A = { lat: -17.8786, lon: 36.8883, text: 'Mercado Central, Quelimane' };
    const B = { lat: -17.8600, lon: 36.9000, text: 'Bairro Coalane, Quelimane' };
    const far = { lat: -17.98, lon: 36.95, text: 'Fora da cidade' };
    ok((await api('POST', '/quotes', { token: cli.token, body: { pickup: A, dropoff: B, weight_kg: 16, service_type: 'normal' } })).status === 400, '16 kg rejeitado');
    ok((await api('POST', '/quotes', { token: cli.token, body: { pickup: A, dropoff: far, weight_kg: 2, service_type: 'normal' } })).data.error === 'fora_cobertura', 'destino fora da cobertura rejeitado');
    const qn = await api('POST', '/quotes', { token: cli.token, body: { pickup: A, dropoff: B, weight_kg: 2, service_type: 'normal' } });
    const qe = await api('POST', '/quotes', { token: cli.token, body: { pickup: A, dropoff: B, weight_kg: 2, service_type: 'expressa' } });
    ok(qn.status === 200 && qn.data.currency === 'MZN' && qn.data.quote_id && qn.data.expires_at, 'cotação devolve quote_id, MZN e validade');
    ok(qe.data.total_cents > qn.data.total_cents, 'expressa custa mais que normal');

    console.log('Pedido e pagamento (BR-06)');
    const orderBody = { quote_id: qn.data.quote_id, recipient_name: 'Dino Destinatário', recipient_phone: '843000001', category: 'documentos', description: 'Envelope A4', payment_method: 'sandbox' };
    ok((await api('POST', '/orders', { token: cli.token, body: orderBody })).status === 400, 'sem Idempotency-Key é rejeitado');
    const o1 = await api('POST', '/orders', { token: cli.token, body: orderBody, idem: 'pedido-0001' });
    const o1b = await api('POST', '/orders', { token: cli.token, body: orderBody, idem: 'pedido-0001' });
    ok(o1.status === 201 && o1.data.status === 'AGUARDA_PAGAMENTO' && /^\d{4}$/.test(o1.data.delivery_code), 'pedido criado, aguarda pagamento, código de entrega gerado');
    ok(o1b.status === 200 && o1b.data.id === o1.data.id, 'repetição com a mesma chave devolve o mesmo pedido');
    ok((await api('POST', '/orders', { token: cli.token, body: orderBody, idem: 'pedido-0002' })).status === 409, 'cotação já usada não cria segundo pedido');
    const orderId = o1.data.id;
    const deliveryCode = o1.data.delivery_code;

    const pi = await api('POST', '/payments/intents', { token: cli.token, body: { order_id: orderId, provider: 'sandbox', msisdn: '842000001' }, idem: 'pag-0001' });
    ok(pi.status === 201 && pi.data.status === 'pending', 'tentativa de pagamento criada no servidor');
    ok((await api('POST', '/payments/intents', { token: cli.token, body: { order_id: orderId, provider: 'sandbox', msisdn: '842000001' }, idem: 'pag-0002' })).status === 409, 'segunda cobrança em paralelo bloqueada');
    const ev = JSON.stringify({ event_id: 'evt-1', intent_id: pi.data.id, status: 'succeeded', amount_cents: pi.data.amount_cents });
    const sig = createHmac('sha256', 'segredo-teste').update(ev).digest('hex');
    const hook = (s) => fetch(`${BASE}/payments/webhook/sandbox`, { method: 'POST', headers: { 'x-levago-signature': s, 'content-type': 'application/json' }, body: ev });
    ok((await hook('assinatura-falsa')).status === 403, 'webhook com assinatura errada rejeitado');
    const h1 = await (await hook(sig)).json();
    const h2 = await (await hook(sig)).json();
    ok(h1.status === 'succeeded' && h2.duplicate === true, 'webhook duplicado é idempotente');
    const late = JSON.stringify({ event_id: 'evt-2', intent_id: pi.data.id, status: 'failed', amount_cents: pi.data.amount_cents });
    await fetch(`${BASE}/payments/webhook/sandbox`, { method: 'POST', headers: { 'x-levago-signature': createHmac('sha256', 'segredo-teste').update(late).digest('hex') }, body: late });
    const afterPay = await api('GET', `/orders/${orderId}`, { token: cli.token });
    ok(afterPay.data.status === 'PENDENTE_ATRIBUICAO' && afterPay.data.payment_status === 'succeeded', 'pagamento confirmado; falha fora de ordem não desfaz');

    console.log('Estafetas (BR-05, BR-08)');
    const c1 = await register('Elias Estafeta', '845000001', 'estafeta');
    const c2 = await register('Fátima Estafeta', '845000002', 'estafeta');
    for (const c of [c1, c2]) {
      const ap = await api('POST', '/courier/apply', { token: c.token, body: { link_type: 'independente', vehicle_kind: 'motorizada', plate: 'ABC-123-MP', ownership: 'particular', capacity_kg: 15, consent: true } });
      c.app = ap.data;
    }
    ok((await api('POST', '/courier/availability', { token: c1.token, body: { online: true } })).status === 403, 'candidato pendente não fica online');
    for (const c of [c1, c2]) {
      await api('POST', `/admin/applications/${c.app.application_id}/review`, { token: adminToken, body: { decision: 'approved', reason: 'Documentos verificados' } });
      await api('POST', `/admin/vehicles/${c.app.vehicle_id}/review`, { token: adminToken, body: { status: 'approved', reason: 'Vistoria feita' } });
      c.token = await login(c === c1 ? '845000001' : '845000002', 'estafeta');
      ok((await api('POST', '/courier/availability', { token: c.token, body: { online: true } })).status === 200, `${c.user.name} aprovado e online`);
    }
    const avail = await api('GET', '/courier/orders/available', { token: c1.token });
    const offer = avail.data.items.find((x) => x.id === orderId);
    ok(!!offer && offer.dropoff_area && !offer.recipient, 'pedido disponível mostra só zona aproximada do destino');
    ok(offer.earning_cents === Math.round(afterPay.data.price_cents * 0.7), 'remuneração do independente = 70% (configurável)');

    console.log('Aceite atómico (M3)');
    const [a1, a2] = await Promise.all([
      api('POST', `/courier/orders/${orderId}/accept`, { token: c1.token }),
      api('POST', `/courier/orders/${orderId}/accept`, { token: c2.token }),
    ]);
    const winner = a1.status === 200 ? c1 : c2;
    ok([a1.status, a2.status].sort().join(',') === '200,409', 'dois estafetas em simultâneo: só um aceita');
    const loser = winner === c1 ? c2 : c1;
    ok((await api('GET', `/courier/orders/${orderId}`, { token: loser.token })).status === 404, 'o outro estafeta deixa de ver o pedido');

    console.log('Recolha, transporte e entrega (BR-09)');
    ok((await api('POST', `/courier/orders/${orderId}/deliver`, { token: winner.token, body: { code: deliveryCode, checklist: [] } })).status === 409, 'não entrega sem recolher');
    ok((await api('POST', `/courier/orders/${orderId}/pickup`, { token: winner.token, body: { checklist: ['volume confere'] } })).status === 200, 'recolha confirmada com prova');
    await api('POST', '/courier/location', { token: winner.token, body: { lat: -17.87, lon: 36.89 } });
    ok((await api('POST', `/courier/orders/${orderId}/start`, { token: winner.token })).status === 200, 'em transporte');
    const track = await api('GET', `/orders/${orderId}`, { token: cli.token });
    ok(track.data.courier_location && track.data.courier?.name === winner.user.name.split(' ')[0], 'cliente vê posição e primeiro nome do estafeta');
    const wrong = deliveryCode === '0000' ? '1111' : '0000';
    ok((await api('POST', `/courier/orders/${orderId}/deliver`, { token: winner.token, body: { code: wrong, checklist: [] } })).data.error === 'codigo_errado', 'código errado rejeitado');
    ok((await api('POST', `/courier/orders/${orderId}/deliver`, { token: winner.token, body: { code: deliveryCode, checklist: ['entregue em mão'] } })).status === 200, 'entrega finalizada com código válido');
    ok((await api('POST', `/courier/orders/${orderId}/deliver`, { token: winner.token, body: { code: deliveryCode, checklist: [] } })).status === 409, 'entrega não se finaliza duas vezes');
    const done = await api('GET', `/orders/${orderId}`, { token: cli.token });
    ok(done.data.status === 'ENTREGUE' && !done.data.courier_location, 'estado final ENTREGUE e localização deixa de ser exposta');
    ok(done.data.events.map((e) => e.to_status).join('>') === 'AGUARDA_PAGAMENTO>PENDENTE_ATRIBUICAO>ACEITE>RECOLHIDO>EM_TRANSPORTE>ENTREGUE', 'linha temporal completa reconstituída (BR-10)');
    ok((await api('GET', `/orders/${orderId}/receipt`, { token: cli.token })).data.code === o1.data.code, 'comprovativo disponível');
    const earn = await api('GET', '/courier/earnings?period=day', { token: winner.token });
    ok(earn.data.total === offer.earning_cents && earn.data.entries.length === 1, 'extrato do estafeta concilia com a entrega');
    ok((await api('POST', `/admin/orders/${orderId}/status`, { token: adminToken, body: { to: 'CANCELADO', reason: 'teste' } })).status === 409, 'admin não altera estado final');

    console.log('Isolamento (BR-05)');
    const other = await register('Gil Outro', '846000001');
    ok((await api('GET', `/orders/${orderId}`, { token: other.token })).status === 404, 'cliente não vê pedido alheio');
    ok((await api('GET', '/orders', { token: other.token })).data.items.length === 0, 'lista só com pedidos próprios');

    console.log('Reembolso com dupla validação');
    const q2 = await api('POST', '/quotes', { token: cli.token, body: { pickup: A, dropoff: B, weight_kg: 1, service_type: 'normal' } });
    const o2 = await api('POST', '/orders', { token: cli.token, body: { ...orderBody, quote_id: q2.data.quote_id }, idem: 'pedido-0003' });
    const pi2 = await api('POST', '/payments/intents', { token: cli.token, body: { order_id: o2.data.id, provider: 'sandbox', msisdn: '842000001' }, idem: 'pag-0003' });
    await api('POST', `/payments/intents/${pi2.data.id}/simulate`, { token: cli.token, body: { outcome: 'succeeded' } });
    ok((await api('POST', `/orders/${o2.data.id}/cancel`, { token: cli.token, body: { reason: 'Já não preciso' } })).status === 200, 'cliente cancela antes do aceite');
    const pays = await api('GET', '/admin/payments', { token: adminToken });
    const refund = pays.data.refunds.find((r) => r.intent_id === pi2.data.id);
    ok(!!refund && refund.status === 'requested', 'cancelamento pago gera pedido de reembolso');
    ok((await api('POST', `/admin/refunds/${refund.id}/decide`, { token: admin2Token, body: { decision: 'approved', reason: 'Política' } })).status === 200, 'outro admin aprova o reembolso');
    const cancelled = await api('GET', `/orders/${o2.data.id}`, { token: cli.token });
    ok(cancelled.data.payment_status === 'refunded', 'pedido fica reembolsado');

    console.log('Subscrição (BR-07)');
    const plan = await api('POST', '/admin/plans', { token: adminToken, body: { name: 'Plano Teste', price_cents: 50000, period_days: 30, deliveries_included: 1, max_weight_kg: 15, service_types: ['normal'] } });
    await api('POST', `/admin/plans/${plan.data.id}/status`, { token: adminToken, body: { status: 'published', reason: 'Teste' } });
    const sub = await api('POST', '/subscriptions', { token: cli.token, body: { plan_id: plan.data.id } });
    const spi = await api('POST', '/payments/intents', { token: cli.token, body: { subscription_id: sub.data.id, provider: 'sandbox', msisdn: '842000001' }, idem: 'pag-sub-1' });
    await api('POST', `/payments/intents/${spi.data.id}/simulate`, { token: cli.token, body: { outcome: 'succeeded' } });
    const q3 = await api('POST', '/quotes', { token: cli.token, body: { pickup: A, dropoff: B, weight_kg: 1, service_type: 'normal' } });
    ok(q3.data.covered_by_subscription && q3.data.total_cents === 0, 'cotação coberta pela subscrição');
    const o3 = await api('POST', '/orders', { token: cli.token, body: { ...orderBody, quote_id: q3.data.quote_id, payment_method: 'subscricao' }, idem: 'pedido-0004' });
    ok(o3.data.status === 'PENDENTE_ATRIBUICAO', 'pedido coberto vai directo para atribuição');
    const q4 = await api('POST', '/quotes', { token: cli.token, body: { pickup: A, dropoff: B, weight_kg: 1, service_type: 'normal' } });
    ok(!q4.data.covered_by_subscription && q4.data.total_cents > 0, 'benefício consumido uma só vez');

    console.log('Atribuição manual pelo Admin');
    const busy = await api('POST', `/admin/orders/${o3.data.id}/assign`, { token: adminToken, body: { courier_id: loser.user.id, reason: 'Mais próximo' } });
    ok(busy.status === 200, 'admin atribui pedido a estafeta elegível');
    const offered = await api('GET', '/courier/orders/available', { token: loser.token });
    ok(offered.data.items.some((x) => x.id === o3.data.id && x.offered_to_me), 'estafeta vê a tarefa atribuída');
    const audit = await api('GET', '/admin/audit?entity=order', { token: adminToken });
    ok(audit.data.some((a) => a.action === 'order.assign' && a.reason === 'Mais próximo'), 'acção administrativa auditada com motivo');

    console.log('Relatórios');
    const dash = await api('GET', '/admin/dashboard', { token: adminToken });
    ok(dash.data.orders.total >= 3 && dash.data.orders.delivered === 1, 'dashboard com totais reais');
    const csv = await fetch(`${BASE}/admin/orders/export.csv`, { headers: { authorization: `Bearer ${adminToken}` } });
    ok(csv.headers.get('content-type')?.startsWith('text/csv') && (await csv.text()).includes(o1.data.code), 'exportação CSV');
  } catch (e) {
    failures++;
    console.error(e);
    console.error(log.slice(-3000));
  } finally {
    try { process.kill(-dev.pid, 'SIGTERM'); } catch {}
    await new Promise((r) => setTimeout(r, 500));
    await adminSql(ADMIN_URL, `DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`).catch(() => {});
  }
  console.log(failures ? `\n${failures} verificação(ões) falharam.` : '\nTodas as verificações passaram.');
  process.exit(failures ? 1 : 0);
}

main();
