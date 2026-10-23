import { Hono } from 'hono';
import { sendOtp } from '../lib/adapters.js';
import { addMinutes, ApiError, bad, conflict, need, normalizePhone, nowIso, one, parseJson, run, uuid, v, type AppName, type Env, type Role, type Vars } from '../lib/core.js';
import { hashPassword, passwordProblem, randomDigits, sha256, verifyPassword } from '../lib/crypto.js';
import { auditStmt, createSession, rateLimit, requireRole } from '../lib/services.js';

const auth = new Hono<{ Bindings: Env; Variables: Vars }>();

const APP_ROLES: Record<AppName, Role[]> = {
  cliente: ['customer'],
  estafeta: ['courier'],
  admin: ['admin', 'super_admin'],
};

/** Passo 1 do registo: valida os dados, guarda-os pendentes e envia o código ao telemóvel. */
auth.post('/register/start', async (c) => {
  const body = need<{ name: string; phone: string; email?: string; password: string; consent_terms: boolean; consent_privacy: boolean; app: AppName }>(await c.req.json(), {
    name: v.str(2, 80),
    phone: v.phone(),
    email: (x) => (x === undefined || x === '' || (typeof x === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)) ? null : 'Email inválido.'),
    password: passwordProblem,
    consent_terms: (x) => (x === true ? null : 'É preciso aceitar os termos.'),
    consent_privacy: (x) => (x === true ? null : 'É preciso aceitar a política de privacidade.'),
    app: v.oneOf('cliente', 'estafeta'),
  });
  const phone = normalizePhone(body.phone)!;
  await rateLimit(c.env.DB, `otp:${phone}`, 5, 60);
  await rateLimit(c.env.DB, `otp-ip:${c.req.header('cf-connecting-ip') ?? 'local'}`, 20, 60);

  const code = randomDigits(6);
  const id = uuid();
  const payload = { name: body.name, email: body.email || null, password_hash: await hashPassword(body.password), app: body.app };
  await run(
    c.env.DB,
    "INSERT INTO phone_verifications (id, phone, purpose, code_hash, expires_at, payload) VALUES (?,?, 'register', ?, ?, ?)",
    id,
    phone,
    await sha256(`${id}:${code}`),
    addMinutes(new Date(), 10).toISOString(),
    JSON.stringify(payload),
  );
  // A resposta é igual exista ou não a conta, para não revelar números registados.
  const existing = await one(c.env.DB, 'SELECT 1 FROM users WHERE phone = ?', phone);
  const sent = existing ? { delivered: false } : await sendOtp(c.env, phone, code);
  return c.json({ verification_id: id, expires_in_s: 600, ...(sent.devCode ? { dev_code: sent.devCode } : {}) });
});

/** Passo 2: confirma o código e cria a conta. */
auth.post('/register/verify', async (c) => {
  const body = need<{ verification_id: string; code: string }>(await c.req.json(), { verification_id: v.str(10, 64), code: v.str(6, 6) });
  const ver = await one<{ id: string; phone: string; code_hash: string; attempts: number; expires_at: string; used_at: string | null; payload: string }>(
    c.env.DB,
    "SELECT * FROM phone_verifications WHERE id = ? AND purpose = 'register'",
    body.verification_id,
  );
  if (!ver || ver.used_at || ver.expires_at < nowIso()) throw bad('codigo_expirado', 'O código expirou. Peça um novo.');
  if (ver.attempts >= 5) throw bad('codigo_bloqueado', 'Demasiadas tentativas. Peça um novo código.');
  if ((await sha256(`${ver.id}:${body.code}`)) !== ver.code_hash) {
    await run(c.env.DB, 'UPDATE phone_verifications SET attempts = attempts + 1 WHERE id = ?', ver.id);
    throw bad('codigo_errado', 'Código incorrecto.');
  }
  if (await one(c.env.DB, 'SELECT 1 FROM users WHERE phone = ?', ver.phone)) throw conflict('telefone_em_uso', 'Não foi possível criar a conta com este número. Inicie sessão ou recupere a palavra-passe.');
  const p = parseJson<{ name: string; email: string | null; password_hash: string; app: AppName }>(ver.payload, null as never);
  const userId = uuid();
  const now = nowIso();
  const stmts = [
    c.env.DB.prepare('UPDATE phone_verifications SET used_at = ? WHERE id = ?').bind(now, ver.id),
    c.env.DB.prepare('INSERT INTO users (id, phone, name, email, password_hash, phone_verified_at, consent_terms_at, consent_privacy_at) VALUES (?,?,?,?,?,?,?,?)').bind(
      userId, ver.phone, p.name, p.email, p.password_hash, now, now, now,
    ),
    c.env.DB.prepare("INSERT INTO user_roles (user_id, role) VALUES (?, 'customer')").bind(userId),
  ];
  await c.env.DB.batch(stmts);
  const session = await createSession(c.env.DB, userId, p.app);
  return c.json({ ...session, user: { id: userId, name: p.name, phone: ver.phone, roles: ['customer'] } }, 201);
});

auth.post('/login', async (c) => {
  const body = need<{ phone: string; password: string; app: AppName }>(await c.req.json(), {
    phone: v.str(3, 120),
    password: v.str(1, 128),
    app: v.oneOf('cliente', 'estafeta', 'admin'),
  });
  // O campo aceita o telemóvel ou, para quem o registou, o email.
  const byEmail = body.phone.includes('@');
  const login = byEmail ? body.phone.trim().toLowerCase() : normalizePhone(body.phone);
  const neutral = new ApiError(401, 'credenciais_invalidas', byEmail ? 'Email ou palavra-passe incorrectos.' : 'Telefone ou palavra-passe incorrectos.');
  if (!login) throw neutral;
  await rateLimit(c.env.DB, `login:${login}`, 10, 15);
  const u = await one<{ id: string; name: string; phone: string; password_hash: string; status: string; locked_until: string | null }>(
    c.env.DB,
    byEmail ? 'SELECT * FROM users WHERE lower(email) = ?' : 'SELECT * FROM users WHERE phone = ?',
    login,
  );
  if (!u || u.status === 'deleted') throw neutral;
  if (u.locked_until && u.locked_until > nowIso()) throw new ApiError(429, 'conta_bloqueada', 'Conta bloqueada temporariamente por tentativas falhadas. Tente mais tarde.');
  if (!(await verifyPassword(body.password, u.password_hash))) {
    await run(
      c.env.DB,
      "UPDATE users SET failed_logins = failed_logins + 1, locked_until = CASE WHEN failed_logins + 1 >= 5 THEN ? ELSE locked_until END WHERE id = ?",
      addMinutes(new Date(), 15).toISOString(),
      u.id,
    );
    throw neutral;
  }
  if (u.status === 'suspended') throw new ApiError(403, 'conta_suspensa', 'A conta está suspensa. Contacte o apoio LevaGo.');
  const roles = (await c.env.DB.prepare('SELECT role FROM user_roles WHERE user_id = ?').bind(u.id).all<{ role: Role }>()).results.map((r) => r.role);
  // O estafeta entra com qualquer conta; a app mostra o estado da candidatura. Admin precisa do papel.
  // A palavra-passe já está certa, por isso podemos dizer claramente porque não entra.
  if (body.app === 'admin' && !APP_ROLES.admin.some((r) => roles.includes(r)))
    throw new ApiError(403, 'sem_acesso_admin', 'Esta conta não tem acesso ao painel administrativo. Use a área de Cliente ou de Estafeta.');
  await run(c.env.DB, 'UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?', u.id);
  if (body.app === 'admin') await c.env.DB.batch([auditStmt(c.env.DB, { id: u.id, role: 'admin' }, 'login', 'session', null)]);
  const session = await createSession(c.env.DB, u.id, body.app);
  return c.json({ ...session, user: { id: u.id, name: u.name, phone: u.phone, roles } });
});

auth.post('/logout', async (c) => {
  const u = requireRole(c, 'customer', 'courier', 'admin', 'super_admin');
  await run(c.env.DB, 'UPDATE sessions SET revoked_at = ? WHERE id = ?', nowIso(), u.sessionId);
  return c.json({ ok: true });
});

auth.post('/logout-all', async (c) => {
  const u = requireRole(c, 'customer', 'courier', 'admin', 'super_admin');
  await run(c.env.DB, 'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', nowIso(), u.id);
  return c.json({ ok: true });
});

/** Recuperação: envia código; resposta neutra. */
auth.post('/reset/start', async (c) => {
  const body = need<{ phone: string }>(await c.req.json(), { phone: v.phone() });
  const phone = normalizePhone(body.phone)!;
  await rateLimit(c.env.DB, `reset:${phone}`, 3, 60);
  const id = uuid();
  const code = randomDigits(6);
  const user = await one(c.env.DB, "SELECT 1 FROM users WHERE phone = ? AND status <> 'deleted'", phone);
  let devCode: string | undefined;
  if (user) {
    await run(c.env.DB, "INSERT INTO phone_verifications (id, phone, purpose, code_hash, expires_at) VALUES (?,?,'reset',?,?)", id, phone, await sha256(`${id}:${code}`), addMinutes(new Date(), 10).toISOString());
    devCode = (await sendOtp(c.env, phone, code)).devCode;
  }
  return c.json({ verification_id: id, message: 'Se o número tiver conta, enviámos um código por SMS.', ...(devCode ? { dev_code: devCode } : {}) });
});

auth.post('/reset/finish', async (c) => {
  const body = need<{ verification_id: string; code: string; password: string }>(await c.req.json(), {
    verification_id: v.str(10, 64),
    code: v.str(6, 6),
    password: passwordProblem,
  });
  const ver = await one<{ id: string; phone: string; code_hash: string; attempts: number; expires_at: string; used_at: string | null }>(
    c.env.DB,
    "SELECT * FROM phone_verifications WHERE id = ? AND purpose = 'reset'",
    body.verification_id,
  );
  if (!ver || ver.used_at || ver.expires_at < nowIso() || ver.attempts >= 5) throw bad('codigo_expirado', 'O código expirou ou é inválido. Peça um novo.');
  if ((await sha256(`${ver.id}:${body.code}`)) !== ver.code_hash) {
    await run(c.env.DB, 'UPDATE phone_verifications SET attempts = attempts + 1 WHERE id = ?', ver.id);
    throw bad('codigo_errado', 'Código incorrecto.');
  }
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE phone_verifications SET used_at = ? WHERE id = ?').bind(now, ver.id),
    c.env.DB.prepare('UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL, updated_at = ? WHERE phone = ?').bind(await hashPassword(body.password), now, ver.phone),
    // Todas as sessões antigas deixam de valer.
    c.env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE revoked_at IS NULL AND user_id = (SELECT id FROM users WHERE phone = ?)').bind(now, ver.phone),
  ]);
  return c.json({ ok: true });
});

auth.get('/me', async (c) => {
  const u = requireRole(c, 'customer', 'courier', 'admin', 'super_admin');
  const row = await one<Record<string, unknown>>(c.env.DB, 'SELECT id, name, phone, email, locale, theme, notify_prefs, created_at FROM users WHERE id = ?', u.id);
  return c.json({ ...row, notify_prefs: parseJson(row?.notify_prefs, {}), roles: u.roles, app: u.app });
});

export default auth;
