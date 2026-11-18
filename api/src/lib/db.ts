import { neon, neonConfig, types as neonTypes, type NeonQueryFunction } from '@neondatabase/serverless';
import pg from 'pg';

// COUNT/SUM devolvem bigint e ROUND/AVG devolvem numeric: os valores da LevaGo cabem num número JS.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

/** Converte os marcadores `?` em `$1, $2, ...`, ignorando os que estão dentro de texto entre aspas. */
export function toPg(sql: string): string {
  let n = 0;
  let out = '';
  let quoted = false;
  for (const ch of sql) {
    if (ch === "'") quoted = !quoted;
    out += ch === '?' && !quoted ? `$${++n}` : ch;
  }
  return out;
}

const param = (v: unknown) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);

/** Instrução preparada com a mesma forma que a API já usava (prepare/bind/first/all/run). */
export class Stmt {
  constructor(
    private db: Db,
    readonly sql: string,
    readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]) {
    return new Stmt(this.db, this.sql, params.map(param));
  }

  exec() {
    return this.db.query(this.sql, this.params);
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return ((await this.exec()).rows[0] as T) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: (await this.exec()).rows as T[] };
  }

  async run() {
    const r = await this.exec();
    return { meta: { changes: r.rowCount ?? 0 } };
  }
}

interface Result {
  rows: Record<string, unknown>[];
  rowCount: number | null;
}

/** Erro do Postgres "divisão por zero": usado para anular uma transacção HTTP quando a 1.ª instrução não muda 1 linha. */
const GUARD_FAILED = '22012';

export class Db {
  /**
   * Duas formas de falar com o Postgres:
   * - `pg` (servidor local e testes): ligação TCP normal, com pool;
   * - `http` (Cloudflare + Neon): cada consulta é um só pedido HTTPS ao Neon, sem abrir ligação.
   *   Abrir uma ligação TCP+TLS a Frankfurt a cada pedido custava quase 1 segundo vindo de Moçambique.
   */
  constructor(
    readonly pool: pg.Pool | null,
    private readonly http: NeonQueryFunction<false, true> | null = null,
  ) {}

  async query(sql: string, params: unknown[]): Promise<Result> {
    if (this.http) return this.http.query(toPg(sql), params as unknown[], HTTP_OPTS);
    return this.pool!.query(toPg(sql), params as unknown[]);
  }

  /** Fecha as ligações. Na Cloudflare cada pedido abre e fecha a sua própria pool. */
  async close() {
    if (!this.pool) return;
    // Depois de fechar, a Cloudflare corta os sockets: esses erros já não interessam.
    this.pool.removeAllListeners('error');
    this.pool.on('error', () => undefined);
    await this.pool.end().catch(() => undefined);
  }

  prepare(sql: string) {
    return new Stmt(this, sql);
  }

  /** Executa todas as instruções numa só transacção: ou grava tudo, ou nada. */
  async batch(stmts: Stmt[]) {
    if (!stmts.length) return;
    if (this.http) {
      await this.http.transaction(stmts.map((s) => this.http!.query(toPg(s.sql), s.params as unknown[], HTTP_OPTS)));
      return;
    }
    await this.tx(async (client) => {
      for (const s of stmts) await client.query(toPg(s.sql), s.params as unknown[]);
    });
  }

  /**
   * Executa `first` e o resto numa só transacção. Se `first` não mudar exactamente 1 linha,
   * nada é gravado e devolve false. É assim que se garante que dois estafetas não aceitam o mesmo pedido.
   */
  async guarded(first: Stmt, rest: Stmt[]): Promise<boolean> {
    if (this.http) {
      // Transacção HTTP num só pedido: a 1.ª instrução vira um teste que dá erro (e anula tudo) se não mudar exactamente 1 linha.
      if (/\breturning\b/i.test(first.sql)) throw new Error('guarded: a primeira instrução não pode ter RETURNING');
      const check = `WITH g AS (${toPg(first.sql)} RETURNING 1) SELECT 1 / (CASE WHEN COUNT(*) = 1 THEN 1 ELSE 0 END) AS ok FROM g`;
      try {
        await this.http.transaction([
          this.http.query(check, first.params as unknown[], HTTP_OPTS),
          ...rest.map((s) => this.http!.query(toPg(s.sql), s.params as unknown[], HTTP_OPTS)),
        ]);
        return true;
      } catch (e) {
        if ((e as { code?: string }).code === GUARD_FAILED) return false;
        throw e;
      }
    }
    return this.tx(async (client) => {
      const r = await client.query(toPg(first.sql), first.params as unknown[]);
      if (r.rowCount !== 1) throw new Rollback();
      for (const s of rest) await client.query(toPg(s.sql), s.params as unknown[]);
      return true;
    }).catch((e) => {
      if (e instanceof Rollback) return false;
      throw e;
    });
  }

  private async tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool!.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }
}

class Rollback extends Error {}

/** Os mesmos conversores de tipos do `pg`: COUNT/SUM (bigint) e ROUND/AVG (numeric) chegam como número. */
const httpTypes = {
  getTypeParser: (id: number, format?: unknown) => (id === 20 || id === 1700 ? (v: string) => Number(v) : neonTypes.getTypeParser(id, format as 'text')),
};

// Os conversores têm de ir em cada consulta: o driver HTTP ignora os que se dão ao criar a ligação.
const HTTP_OPTS = { fullResults: true, types: httpTypes } as const;

/** Ligação por HTTP ao Neon (Cloudflare). Só serve para endereços do Neon. */
export function openHttpDb(url: string): Db {
  return new Db(null, neon(url, { fullResults: true }));
}

export const isNeonUrl = (url: string | undefined) => !!url && /\.neon\.tech([:/]|$)/.test(url);

let shared: Db | null = null;

/** Abre uma pool nova. Use o endereço "pooled" do Neon. */
export function openDb(url: string | undefined, max = 5): Db {
  if (!url) throw new Error('DATABASE_URL em falta');
  const local = /@(localhost|127\.0\.0\.1)|host=\/|@\/|\/\/\//.test(url);
  const pool = new pg.Pool({ connectionString: url, max, idleTimeoutMillis: 10_000, ssl: local ? undefined : { rejectUnauthorized: true } });
  // O Neon pode fechar ligações paradas; sem isto, o erro derrubava a função.
  pool.on('error', (err) => console.error('pg pool', err.message));
  return new Db(pool);
}

/** Uma pool partilhada por processo (servidor local e testes). */
export function getDb(url = process.env.DATABASE_URL): Db {
  // Testes: NEON_FETCH_ENDPOINT aponta o modo HTTP para uma imitação local do Neon.
  if (process.env.NEON_FETCH_ENDPOINT) neonConfig.fetchEndpoint = process.env.NEON_FETCH_ENDPOINT;
  // DB_DRIVER=http testa localmente o mesmo caminho da Cloudflare (precisa de um endereço do Neon).
  if (!shared) shared = process.env.DB_DRIVER === 'http' && url ? openHttpDb(url) : openDb(url);
  return shared;
}
