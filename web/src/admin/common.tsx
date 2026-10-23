import type { ReactNode } from 'react';
import type { Api } from '../shared/api';

/** Descarrega um ficheiro protegido (CSV, documento) com a sessão do administrador. */
export async function download(api: Api, path: string, filename?: string) {
  const res = await api.raw(path);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  if (filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  } else {
    window.open(url, '_blank', 'noopener');
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function Table({ head, rows, empty = 'Sem resultados.' }: { head: string[]; rows: ReactNode[][]; empty?: string }) {
  return (
    <div className="table-wrap table-cards">
      <table>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={head.length} className="center muted">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j} data-label={head[j]}>
                    {c}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ''}`}>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}

/** Gráfico de barras simples (sem bibliotecas), para a série diária do painel. */
export function Bars({ data, label, value, format = String }: { data: Record<string, any>[]; label: string; value: string; format?: (n: number) => string }) {
  const max = Math.max(1, ...data.map((d) => Number(d[value]) || 0));
  return (
    <div className="bars" role="img" aria-label={`Gráfico de ${value}`}>
      {data.map((d) => (
        <div key={d[label]} className="bar" title={`${d[label]}: ${format(Number(d[value]) || 0)}`}>
          <span style={{ height: `${((Number(d[value]) || 0) / max) * 100}%` }} />
          <small>{String(d[label]).slice(5)}</small>
        </div>
      ))}
    </div>
  );
}
