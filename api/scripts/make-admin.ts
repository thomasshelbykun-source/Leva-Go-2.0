// Dá o papel de super-administrador a uma conta já registada (usar uma vez, no arranque).
// Uso: DATABASE_URL=... npm run make-admin -- +258841234567
import pg from 'pg';

const phone = process.argv[2] ?? '';
if (!/^\+2588[2-7]\d{7}$/.test(phone)) throw new Error(`Telefone inválido: "${phone}". Use o formato +2588XXXXXXXX.`);
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const r = await client.query(
    `INSERT INTO user_roles (user_id, role) SELECT u.id, r.role FROM users u CROSS JOIN (VALUES ('super_admin'), ('admin')) AS r(role)
      WHERE u.phone = $1 ON CONFLICT DO NOTHING`,
    [phone],
  );
  console.log(r.rowCount ? `Administrador criado para ${phone}.` : `Nada mudou: a conta ${phone} não existe ou já é administrador.`);
} finally {
  await client.end();
}
