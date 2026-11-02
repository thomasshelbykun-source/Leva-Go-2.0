// Cliente da Pagar API (pagar.co.mz, Orion Code Tech) para M-Pesa e e-Mola.
// Regras da documentação (https://pagar.co.mz/docs), seguidas aqui:
// - Só o backend fala com a Pagar. A chave, o segredo de assinatura e o segredo do webhook ficam
//   nas variáveis de ambiente da Vercel, nunca no site, na app ou no Git.
// - O valor e o título vêm da nossa base de dados, nunca do navegador.
// - Valores em MZN inteiros, de 20 a 40 000 MZN por pagamento.
// - POST assinado com HMAC (timestamp, nonce, método, caminho, hash do corpo) e Idempotency-Key.
// - Só se entrega o serviço com o estado PAID, recebido por webhook validado ou confirmado por consulta.
import crypto from 'node:crypto';
import { ApiError, type Env } from './core.js';

export const PAGAR_MIN_MZN = 20;
export const PAGAR_MAX_MZN = 40_000;

export type PagarStatus = 'PENDING' | 'PROCESSING' | 'PAID' | 'CANCELLED' | 'FAILED' | 'RECONCILIATION_REQUIRED' | 'REFUNDED';

export interface PagarPayment {
  id: string;
  status: PagarStatus;
  amountMzn: number;
  method: 'MPESA' | 'EMOLA';
  environment?: 'TEST' | 'LIVE';
  reference: string;
  failureReason?: string | null;
  safeMessage?: string | null;
  retryAllowed?: boolean;
  receipt?: { number?: string; url?: string } | null;
}

/** A Pagar está configurada? Em produção, chaves de teste (dinheiro simulado) não contam. */
export function pagarReady(env: Env): boolean {
  if (!env.PAGAR_API_KEY || !env.PAGAR_SIGNING_SECRET) return false;
  if (env.ENVIRONMENT === 'production' && env.PAGAR_API_KEY.startsWith('sk_test')) return false;
  return true;
}

function base(env: Env) {
  return (env.PAGAR_API_BASE_URL ?? 'https://api.pagar.co.mz/api/v1').replace(/\/$/, '');
}

async function read<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string; requestId?: string };
  if (!res.ok) {
    // Guardamos o requestId para o apoio da Pagar, sem segredos nem números completos.
    console.error('pagar', res.status, data.error, data.requestId);
    const status = res.status === 409 ? 409 : res.status >= 500 || res.status === 429 ? 503 : 400;
    throw new ApiError(status, 'pagamento_recusado', data.message || 'O provedor de pagamentos recusou o pedido.');
  }
  return data as T;
}

export async function pagarGet<T>(env: Env, path: string): Promise<T> {
  const res = await fetch(base(env) + path, { headers: { Authorization: `Bearer ${env.PAGAR_API_KEY}` } });
  return read<T>(res);
}

export async function pagarPost<T>(env: Env, path: string, body: unknown, idempotencyKey: string): Promise<T> {
  const url = base(env) + path;
  const timestamp = Date.now().toString();
  const nonce = crypto.randomBytes(18).toString('base64url');
  const raw = JSON.stringify(body);
  const bodyHash = crypto.createHash('sha256').update(raw).digest('hex');
  const canonical = [timestamp, nonce, 'POST', new URL(url).pathname, bodyHash].join('\n');
  const signature = crypto.createHmac('sha256', env.PAGAR_SIGNING_SECRET!).update(canonical).digest('hex');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.PAGAR_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
      'X-Pagar-Timestamp': timestamp,
      'X-Pagar-Nonce': nonce,
      'X-Pagar-Signature': `v1=${signature}`,
    },
    body: raw,
  });
  return read<T>(res);
}

/** Número local de 9 dígitos (84XXXXXXX), como a Pagar pede. */
export function localMsisdn(msisdn: string) {
  return msisdn.replace(/^\+?258/, '');
}

/** Cobrança C2B. A referência é o id da nossa tentativa de pagamento. */
export async function pagarCharge(
  env: Env,
  p: { reference: string; title: string; description: string; amountMzn: number; method: 'MPESA' | 'EMOLA'; msisdn: string },
) {
  if (!Number.isInteger(p.amountMzn) || p.amountMzn < PAGAR_MIN_MZN || p.amountMzn > PAGAR_MAX_MZN)
    throw new ApiError(400, 'valor_invalido', `O pagamento móvel aceita de ${PAGAR_MIN_MZN} a ${PAGAR_MAX_MZN.toLocaleString('pt-PT')} MT.`);
  const { payment } = await pagarPost<{ payment: PagarPayment }>(
    env,
    '/payments',
    { reference: p.reference, title: p.title, description: p.description, amountMzn: p.amountMzn, method: p.method, payerPhone: localMsisdn(p.msisdn) },
    `payment:${p.reference}`,
  );
  return payment;
}

/** Valida o cabeçalho Pagar-Signature «t=<segundos>,v1=<hex>» com HMAC(t + '.' + corpo). */
export function verifyPagarWebhook(secret: string, header: string, raw: string, nowMs = Date.now()): boolean {
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=') as [string, string]));
  const t = parts.t ?? '';
  const v1 = parts.v1 ?? '';
  if (!/^\d+$/.test(t) || !/^[a-f0-9]{64}$/.test(v1)) return false;
  if (Math.abs(nowMs / 1000 - Number(t)) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(v1, 'hex'), Buffer.from(expected, 'hex'));
}

/** Converte o estado da Pagar no nosso: só PAID confirma; FAILED e CANCELLED falham; o resto espera. */
export function mapPagarStatus(s: PagarStatus): 'succeeded' | 'failed' | null {
  if (s === 'PAID') return 'succeeded';
  if (s === 'FAILED' || s === 'CANCELLED') return 'failed';
  return null;
}
