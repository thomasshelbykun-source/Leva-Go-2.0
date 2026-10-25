import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { encryptPayload, vapidHeader } from '../src/lib/push.js';

const b64u = (b: Buffer) => b.toString('base64url');

/** Lado do telemóvel: decifra a mensagem como o navegador faria (RFC 8291). */
function decrypt(body: Buffer, uaPrivate: Buffer, uaPublic: Buffer, auth: Buffer): string {
  const salt = body.subarray(0, 16);
  const idLen = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idLen);
  const data = body.subarray(21 + idLen);
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(uaPrivate);
  const shared = ecdh.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, auth, keyInfo, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(data.subarray(data.length - 16));
  const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
  expect(plain[plain.length - 1]).toBe(2);
  return plain.subarray(0, plain.length - 1).toString();
}

describe('push', () => {
  it('cifra e decifra a mensagem', () => {
    const ua = createECDH('prime256v1');
    const uaPublic = ua.generateKeys();
    const auth = randomBytes(16);
    const msg = JSON.stringify({ title: 'LG-1001: Em transporte', body: 'A sua encomenda está a caminho.' });
    const body = encryptPayload(Buffer.from(msg), b64u(uaPublic), b64u(auth));
    expect(body.readUInt32BE(16)).toBe(4096);
    expect(decrypt(body, ua.getPrivateKey(), uaPublic, auth)).toBe(msg);
  });

  it('assina o cabeçalho VAPID com ES256', () => {
    const k = createECDH('prime256v1');
    const pub = k.generateKeys();
    const header = vapidHeader('https://push.example.com/send/abc', b64u(pub), b64u(k.getPrivateKey()), 'mailto:a@b.co', 1_700_000_000_000);
    const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header)!;
    expect(m).toBeTruthy();
    const claims = JSON.parse(Buffer.from(m[2]!, 'base64url').toString());
    expect(claims.aud).toBe('https://push.example.com');
    expect(claims.exp).toBe(1_700_000_000 + 12 * 3600);
    const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: 'jwk' });
    expect(verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3]!, 'base64url'))).toBe(true);
  });
});
