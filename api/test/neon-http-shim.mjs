// Imitação local do endpoint HTTP do Neon (/sql), por cima de um Postgres normal.
// Serve para testar o caminho da Cloudflare (DB_DRIVER=http) sem acesso ao Neon.
import { createServer } from 'node:http';
import pg from 'pg';

export function startNeonShim(databaseUrl, port = 8797) {
  const raw = { getTypeParser: () => (v) => v };
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
  pool.on('error', () => undefined);
  const asNeon = (r) => ({
    command: r.command,
    rowCount: r.rowCount,
    fields: r.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
    rows: r.rows,
  });
  const run = (client, q) => client.query({ text: q.query, values: q.params, rowMode: 'array', types: raw });
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const data = JSON.parse(body);
    const client = await pool.connect();
    try {
      let out;
      if (Array.isArray(data.queries)) {
        await client.query('BEGIN');
        try {
          const results = [];
          for (const q of data.queries) results.push(asNeon(await run(client, q)));
          await client.query('COMMIT');
          out = { results };
        } catch (e) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw e;
        }
      } else out = asNeon(await run(client, data));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
    } catch (e) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: e.message, code: e.code, constraint: e.constraint }));
    } finally {
      client.release();
    }
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r({ close: () => (server.close(), pool.end()) })));
}
