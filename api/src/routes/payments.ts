import type { Db } from '../lib/db';
import { Hono } from 'hono';
import { ApiError, bad, forbidden, isProd, need, notFound, nowIso, one, parseJson, uuid, v, type Env, type Vars } from '../lib/core';
import { hmacSha256, timingSafeEqual } from '../lib/crypto';
import { guardedBatch, notifyStmt, requireRole, transition, type OrderRow } from '../lib/services';

const r = new Hono<{ Bindings: Env; Variables: Vars }>();

export interface ProviderEvent {
  event_id: string;
  intent_id: string;
  status: 'succeeded' | 'failed';
  amount_cents: number;
  reason?: string;
}

/**
 * Aplica um evento do provedor. Idempotente: o mesmo event_id só tem efeito uma vez,
 * e eventos fora de ordem (falha depois de sucesso) não desfazem um pagamento confirmado.
 */
export async function applyPaymentEvent(db: Db, ev: ProviderEvent, raw: string) {
  const pi = await one<{ id: string; status: string; amount_cents: number; order_id: string | null; subscription_id: string | null; customer_id: string }>(
    db, 'SELECT * FROM payment_intents WHERE id = ?', ev.intent_id,
  );
  if (!pi) throw notFound('Tentativa de pagamento desconhecida.');
  if (ev.amount_cents !== pi.amount_cents) throw bad('valor_divergente', 'O valor do evento não coincide com a cobrança.');

  const recorded = await guardedBatch(
    db,
    db.prepare("INSERT INTO payment_transactions (id, intent_id, provider_event_id, kind, status, amount_cents, raw) VALUES (?,?,?, 'charge', ?, ?, ?) ON CONFLICT DO NOTHING").bind(
      uuid(), pi.id, ev.event_id, ev.status, ev.amount_cents, raw.slice(0, 4000),
    ),
    [],
  );
  if (!recorded) return { duplicate: true, status: pi.status };
  if (pi.status !== 'pending') return { duplicate: false, ignored: true, status: pi.status };

  const now = nowIso();
  if (ev.status === 'failed') {
    await db.batch([
      db.prepare("UPDATE payment_intents SET status = 'failed', failure_reason = ?, updated_at = ? WHERE id = ? AND status = 'pending'").bind(ev.reason ?? 'Pagamento recusado', now, pi.id),
      ...(pi.order_id ? [db.prepare("UPDATE orders SET payment_status = 'failed', updated_at = ? WHERE id = ? AND status = 'AGUARDA_PAGAMENTO'").bind(now, pi.order_id)] : []),
      notifyStmt(db, pi.customer_id, `payment:${pi.id}:failed`, 'pagamento', 'Pagamento não concluído', 'O pagamento falhou. Pode tentar de novo na app.', pi.order_id),
    ]);
    return { status: 'failed' };
  }

  const setPaid = db.prepare("UPDATE payment_intents SET status = 'succeeded', updated_at = ? WHERE id = ? AND status = 'pending'").bind(now, pi.id);
  if (pi.order_id) {
    const o = await one<OrderRow>(db, 'SELECT * FROM orders WHERE id = ?', pi.order_id);
    if (o && o.status === 'AGUARDA_PAGAMENTO') {
      await transition(db, o, 'PENDENTE_ATRIBUICAO', { id: null, role: 'system' }, { set: { payment_status: 'succeeded' }, note: "Pagamento confirmado", extra: [setPaid] });
    } else {
      // Pedido cancelado entretanto: o dinheiro entrou, por isso abre-se reembolso para o Admin.
      await db.batch([
        setPaid,
        db.prepare("INSERT INTO refunds (id, intent_id, amount_cents, reason, requested_by) VALUES (?,?,?, 'Pagamento recebido após cancelamento', ?)").bind(uuid(), pi.id, pi.amount_cents, pi.customer_id),
      ]);
    }
  } else if (pi.subscription_id) {
    const s = await one<{ id: string; plan_snapshot: string; status: string }>(db, 'SELECT * FROM subscriptions WHERE id = ?', pi.subscription_id);
    const plan = parseJson<{ period_days: number; deliveries_included: number; name: string }>(s?.plan_snapshot, { period_days: 30, deliveries_included: 0, name: '' });
    const end = new Date(Date.now() + plan.period_days * 86_400_000).toISOString();
    await db.batch([
      setPaid,
      db.prepare("UPDATE subscriptions SET status = 'active', current_period_start = ?, current_period_end = ? WHERE id = ? AND status = 'pending_payment'").bind(now, end, pi.subscription_id),
      db.prepare('INSERT INTO subscription_entitlements (id, subscription_id, period_start, period_end, deliveries_total) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING').bind(uuid(), pi.subscription_id, now, end, plan.deliveries_included),
      db.prepare("INSERT INTO invoices (id, customer_id, subscription_id, amount_cents, status) VALUES (?,?,?,?, 'paid')").bind(uuid(), pi.customer_id, pi.subscription_id, pi.amount_cents),
      notifyStmt(db, pi.customer_id, `sub:${pi.subscription_id}:active`, 'subscricao', 'Subscrição activa', `O plano ${plan.name} está activo.`),
    ]);
  }
  return { status: 'succeeded' };
}

/** Webhook do provedor. Exige assinatura HMAC no cabeçalho X-LevaGo-Signature. */
r.post('/webhook/:provider', async (c) => {
  const provider = c.req.param('provider');
  if (!['sandbox', 'mpesa', 'emola'].includes(provider)) throw notFound();
  if (provider === 'sandbox' && isProd(c.env)) throw notFound();
  const raw = await c.req.text();
  const secret = c.env.PAYMENTS_WEBHOOK_SECRET;
  if (!secret) throw new ApiError(503, 'webhook_desligado', 'Webhook sem segredo configurado.');
  const sig = c.req.header('X-LevaGo-Signature') ?? '';
  if (!timingSafeEqual(sig, await hmacSha256(secret, raw))) throw forbidden('Assinatura inválida.');
  // M-Pesa e e-Mola: o formato oficial será mapeado aqui quando houver acesso às APIs (pendência 14.3).
  if (provider !== 'sandbox') throw new ApiError(501, 'nao_implementado', 'Provedor ainda não integrado.');
  const ev = need<ProviderEvent>(JSON.parse(raw), {
    event_id: v.str(4, 100), intent_id: v.str(10, 64), status: v.oneOf('succeeded', 'failed'), amount_cents: v.int(1, 1e9), reason: v.optStr(300),
  });
  return c.json(await applyPaymentEvent(c.env.DB, ev, raw));
});

/**
 * Só fora de produção: o cliente simula a confirmação no telemóvel (como se aprovasse no M-Pesa).
 * Passa pelo mesmo código do webhook, para testar o fluxo completo em staging.
 */
r.post('/intents/:id/simulate', async (c) => {
  if (isProd(c.env)) throw notFound();
  const u = requireRole(c, 'customer');
  const b = need<{ outcome: 'succeeded' | 'failed' }>(await c.req.json(), { outcome: v.oneOf('succeeded', 'failed') });
  const pi = await one<{ id: string; amount_cents: number; provider: string }>(c.env.DB, 'SELECT * FROM payment_intents WHERE id = ? AND customer_id = ?', c.req.param('id'), u.id);
  if (!pi) throw notFound();
  if (pi.provider !== 'sandbox') throw bad('simulacao', 'Só pagamentos de teste podem ser simulados.');
  const ev: ProviderEvent = { event_id: `sim-${pi.id}`, intent_id: pi.id, status: b.outcome, amount_cents: pi.amount_cents, reason: b.outcome === 'failed' ? 'Recusado na simulação' : undefined };
  return c.json(await applyPaymentEvent(c.env.DB, ev, JSON.stringify(ev)));
});

export default r;
