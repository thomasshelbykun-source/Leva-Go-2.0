// Entrada da API na Cloudflare (Workers). O mesmo código Hono corre no servidor local (scripts/dev.ts).
import { app, housekeeping, loadEnv } from './index.js';

interface Ctx {
  waitUntil(p: Promise<unknown>): void;
}

export default {
  fetch: app.fetch,

  /** Agendador do Worker (wrangler.toml, a cada 15 minutos): cancela pedidos por pagar e limpa dados antigos. */
  async scheduled(_event: unknown, bindings: Record<string, string | undefined>, ctx: Ctx) {
    const env = loadEnv(bindings);
    ctx.waitUntil(housekeeping(env).catch((err) => console.error('housekeeping', err)).finally(() => env.DB.close()));
  },
};
