// Servidor local da API (http://localhost:8787). Lê as variáveis de api/.env.local.
import { serve } from '@hono/node-server';
import { existsSync } from 'node:fs';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const { app } = await import('../src/index');
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => console.log(`API em http://127.0.0.1:${port}`));
