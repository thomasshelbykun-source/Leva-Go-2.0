// Aplica as migrações de db/ por ordem (cada uma só uma vez). Uso: DATABASE_URL=... npm run db:migrate
// Com --seed também carrega os dados de teste (zona e tarifa de staging).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Defina DATABASE_URL.');
const dir = join(import.meta.dirname, '..', 'db');
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  for (const name of readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort()) {
    if (done.has(name)) continue;
    await client.query('BEGIN');
    await client.query(readFileSync(join(dir, name), 'utf8'));
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
    await client.query('COMMIT');
    console.log(`Aplicada: ${name}`);
  }
  if (process.argv.includes('--seed')) {
    await client.query(readFileSync(join(dir, 'seed-staging.sql'), 'utf8'));
    console.log('Dados de teste carregados.');
  }
} finally {
  await client.end();
}
