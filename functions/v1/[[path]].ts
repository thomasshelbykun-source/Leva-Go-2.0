// API do LevaGo dentro do próprio site (Cloudflare Pages Functions).
// Todos os pedidos para /v1/... vão para a mesma API Hono do Worker (api/src).
// Assim o site e a API têm o mesmo endereço (por exemplo https://levago.pages.dev/v1/config).
import { app, housekeeping, loadEnv } from '../../api/src/index.js';

type Bindings = Record<string, string | undefined>;

interface PagesContext {
  request: Request;
  env: Bindings;
  waitUntil(p: Promise<unknown>): void;
  passThroughOnException(): void;
}

// O Pages não tem agendador: a limpeza corre no máximo a cada 15 minutos, depois de um pedido.
let lastHousekeeping = 0;

export const onRequest = async (ctx: PagesContext): Promise<Response> => {
  const res = await app.fetch(ctx.request, ctx.env, {
    waitUntil: (p: Promise<unknown>) => ctx.waitUntil(p),
    passThroughOnException: () => ctx.passThroughOnException(),
    props: {},
  });
  if (ctx.env.DATABASE_URL && Date.now() - lastHousekeeping > 15 * 60_000) {
    lastHousekeeping = Date.now();
    const env = loadEnv(ctx.env);
    ctx.waitUntil(housekeeping(env).catch((err) => console.error('housekeeping', err)).finally(() => env.DB.close()));
  }
  return res;
};
