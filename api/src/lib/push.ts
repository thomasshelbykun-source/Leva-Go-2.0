// Notificações push (Web Push, RFC 8030, 8291 e 8292) sem bibliotecas externas.
// As chaves vêm das variáveis VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY e VAPID_SUBJECT. Sem elas, o push fica desligado.
import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign } from 'node:crypto';
import { all, run } from './core.js';
import type { Db } from './db.js';

const b64u = (b: Buffer) => b.toString('base64url');
const fromB64u = (s: string) => Buffer.from(s, 'base64url');

export const pushPublicKey = () => process.env.VAPID_PUBLIC_KEY ?? null;
export const pushEnabled = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

/** Cabeçalho Authorization (VAPID) para o servidor de push de `endpoint`. */
export function vapidHeader(endpoint: string, publicKey: string, privateKey: string, subject: string, now = Date.now()): string {
  const pub = fromB64u(publicKey);
  const key = createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', d: privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
    format: 'jwk',
  });
  const head = b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const sig = sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${publicKey}`;
}

/** Cifra a mensagem para o telemóvel (aes128gcm, RFC 8291). */
export function encryptPayload(payload: Buffer, p256dh: string, authSecret: string): Buffer {
  const uaPublic = fromB64u(p256dh);
  const auth = fromB64u(authSecret);
  const ecdh = createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const shared = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, auth, keyInfo, 32));
  const salt = randomBytes(16);
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const data = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const head = Buffer.alloc(21);
  salt.copy(head, 0);
  head.writeUInt32BE(4096, 16);
  head.writeUInt8(asPublic.length, 20);
  return Buffer.concat([head, asPublic, data]);
}

export interface PushMessage {
  title: string;
  body: string;
  url?: string;
}

/** Envia a mensagem a todos os aparelhos do utilizador. Nunca lança erro: o push é um extra. */
export async function sendPush(db: Db, userId: string, msg: PushMessage): Promise<void> {
  if (!pushEnabled()) return;
  try {
    const subs = await all<{ id: string; endpoint: string; p256dh: string; auth: string }>(db, 'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?', userId);
    const pub = process.env.VAPID_PUBLIC_KEY!;
    const priv = process.env.VAPID_PRIVATE_KEY!;
    const subject = process.env.VAPID_SUBJECT ?? 'mailto:suporte@levago.example';
    await Promise.all(
      subs.map(async (s) => {
        try {
          const res = await fetch(s.endpoint, {
            method: 'POST',
            headers: {
              Authorization: vapidHeader(s.endpoint, pub, priv, subject),
              'Content-Encoding': 'aes128gcm',
              'Content-Type': 'application/octet-stream',
              TTL: '3600',
              Urgency: 'high',
            },
            body: encryptPayload(Buffer.from(JSON.stringify(msg)), s.p256dh, s.auth),
            signal: AbortSignal.timeout(8000),
          });
          if (res.status === 404 || res.status === 410) await run(db, 'DELETE FROM push_subscriptions WHERE id = ?', s.id);
        } catch (err) {
          console.error('push', (err as Error).message);
        }
      }),
    );
  } catch (err) {
    console.error('push', (err as Error).message);
  }
}
