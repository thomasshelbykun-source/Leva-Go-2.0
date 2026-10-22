import pg from 'pg';

// COUNT/SUM devolvem bigint e ROUND/AVG devolvem numeric: os valores da LevaGo cabem num número JS.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

type Client = Pick<pg.PoolClient, 'query'>;

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

  async exec(client?: Client) {
    return (client ?? this.db.pool).query(toPg(this.sql), this.params as unknown[]);
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

export class Db {
  constructor(readonly pool: pg.Pool) {}

  prepare(sql: string) {
    return new Stmt(this, sql);
  }

  /** Executa todas as instruções numa só transacção: ou grava tudo, ou nada. */
  async batch(stmts: Stmt[]) {
    await this.tx(async (client) => {
      for (const s of stmts) await s.exec(client);
    });
  }

  /**
   * Executa `first` e o resto numa só transacção. Se `first` não mudar exactamente 1 linha,
   * nada é gravado e devolve false. É assim que se garante que dois estafetas não aceitam o mesmo pedido.
   */
  async guarded(first: Stmt, rest: Stmt[]): Promise<boolean> {
    return this.tx(async (client) => {
      const r = await first.exec(client);
      if (r.rowCount !== 1) throw new Rollback();
      for (const s of rest) await s.exec(client);
      return true;
    }).catch((e) => {
      if (e instanceof Rollback) return false;
      throw e;
    });
  }

  private async tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
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

let shared: Db | null = null;

/** Uma pool por instância da função. Na Vercel, use o endereço "pooled" do Neon. */
export function getDb(url = process.env.DATABASE_URL): Db {
  if (shared) return shared;
  if (!url) throw new Error('DATABASE_URL em falta');
  const local = /@(localhost|127\.0\.0\.1)|host=\/|@\/|\/\/\//.test(url);
  const pool = new pg.Pool({ connectionString: url, max: 5, idleTimeoutMillis: 10_000, ssl: local ? undefined : { rejectUnauthorized: true } });
  // O Neon pode fechar ligações paradas; sem isto, o erro derrubava a função.
  pool.on('error', (err) => console.error('pg pool', err.message));
  shared = new Db(pool);
  return shared;
}
