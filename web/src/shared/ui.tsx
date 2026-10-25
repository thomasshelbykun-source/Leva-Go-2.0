import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from './api';
import { Icon, type IconName } from './brand';
import { STAGE_LABELS, stageOf, STATUS_LABEL, STATUS_TONE } from './format';

// ------------------------------------------------------------------ Dados
/** Carrega dados e guarda os estados de carregamento e erro. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = [], pollMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      setData(await fnRef.current());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'erro', 'Ocorreu um erro inesperado.'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
    if (!pollMs) return;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void reload(true);
    }, pollMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, loading, reload, setData };
}

/** Executa uma acção e guarda o erro e o estado ocupado. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(-1, 'erro', e instanceof Error ? e.message : 'Ocorreu um erro inesperado.'));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, setError };
}

// ------------------------------------------------------------------ Estrutura
export function Page({ title, back, actions, children, wide }: { title: string; back?: string | true; actions?: ReactNode; children: ReactNode; wide?: boolean }) {
  const nav = useNavigate();
  return (
    <div className={wide ? 'page page-wide' : 'page'}>
      <header className="page-head">
        {back && (
          <button className="icon-btn" aria-label="Voltar" onClick={() => (back === true ? nav(-1) : nav(back))}>
            <Icon name="back" />
          </button>
        )}
        <h1>{title}</h1>
        <div className="page-actions">{actions}</div>
      </header>
      {children}
    </div>
  );
}

/** Painel branco que sobe por cima do mapa, como nas apps de transporte. */
export function Sheet({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`sheet ${className}`}>
      <div className="sheet-handle" aria-hidden="true" />
      {children}
    </section>
  );
}

/** Interruptor (ligar e desligar). */
export function Switch({ checked, onChange, busy, label }: { checked: boolean; onChange: () => void; busy?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={busy} className={`switch ${checked ? 'on' : ''}`} onClick={onChange}>
      <span className="switch-knob" />
    </button>
  );
}

export function Card({ children, className = '', onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div className={`card ${className} ${onClick ? 'clickable' : ''}`} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}>
      {children}
    </div>
  );
}

export function Button({ children, kind = 'primary', busy, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'secondary' | 'danger' | 'ghost'; busy?: boolean }) {
  return (
    <button className={`btn btn-${kind}`} disabled={busy || rest.disabled} {...rest}>
      {busy ? 'Aguarde…' : children}
    </button>
  );
}

export function ButtonLink({ to, children, kind = 'primary' }: { to: string; children: ReactNode; kind?: string }) {
  return (
    <Link className={`btn btn-${kind}`} to={to}>
      {children}
    </Link>
  );
}

export function Field({ label, error, hint, children }: { label: string; error?: string | null; hint?: string; children: ReactNode }) {
  return (
    <label className={`field ${error ? 'has-error' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

/** Linha cinzenta animada que ocupa o lugar do conteúdo enquanto carrega. */
export function Skeleton({ w = '100%', h = 14, round = false }: { w?: string | number; h?: number; round?: boolean }) {
  return <span className="skeleton" style={{ width: w, height: h, borderRadius: round ? '50%' : 8 }} aria-hidden="true" />;
}

export function Loading({ text = 'A carregar…', rows = 3 }: { text?: string; rows?: number }) {
  return (
    <div className="stack" role="status" aria-label={text}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="card skeleton-card">
          <Skeleton w="40%" h={16} />
          <Skeleton w="85%" />
          <Skeleton w="60%" />
        </div>
      ))}
    </div>
  );
}

export function ErrorBox({ error, retry }: { error: ApiError | null; retry?: () => void }) {
  if (!error) return null;
  const perm = error.status === 403;
  return (
    <div className={`alert ${perm ? 'alert-warn' : 'alert-bad'}`} role="alert">
      <strong>{perm ? 'Sem permissão' : error.status === 0 ? 'Sem ligação' : 'Não foi possível concluir'}</strong>
      <p>{error.message}</p>
      {error.details && typeof error.details === 'object' && (
        <ul>
          {Object.entries(error.details).map(([k, v]) => (
            <li key={k}>{String(v)}</li>
          ))}
        </ul>
      )}
      {retry && (
        <button className="btn btn-secondary btn-sm" onClick={retry}>
          Tentar de novo
        </button>
      )}
    </div>
  );
}

export function Empty({ title, text, action, icon = 'box' }: { title: string; text?: string; action?: ReactNode; icon?: IconName }) {
  return (
    <div className="state empty">
      <div className="empty-icon">
        <Icon name={icon} size={30} />
      </div>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

/** Barra com as 4 etapas da entrega. Não aparece em pedidos cancelados ou com falha. */
export function OrderProgress({ status, labels = true }: { status: string; labels?: boolean }) {
  const stage = stageOf(status);
  if (stage < 0) return null;
  return (
    <div className="progress-wrap">
      <div className="progress" role="img" aria-label={`Etapa ${Math.max(stage, 1)} de 4`}>
        {STAGE_LABELS.map((l, i) => (
          <span key={l} className={i < stage ? 'on' : ''} />
        ))}
      </div>
      {labels && (
        <div className="progress-labels">
          {STAGE_LABELS.map((l, i) => (
            <small key={l} className={i < stage ? 'on' : ''}>
              {l}
            </small>
          ))}
        </div>
      )}
    </div>
  );
}

/** Cartão de encomenda: cor do estado à esquerda, destino e barra de progresso. */
export function OrderCard({ o, onClick }: { o: any; onClick: () => void }) {
  return (
    <div className={`card clickable order-card tone-${STATUS_TONE[o.status] ?? 'muted'}`} onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onClick()}>
      <div className="row-between">
        <strong>{o.code}</strong>
        <StatusBadge status={o.status} label={o.status_label} />
      </div>
      <span className="ellipsis">Para {o.dropoff?.text}</span>
      <OrderProgress status={o.status} labels={false} />
      <div className="row-between small">
        <span>{new Date(o.created_at).toLocaleString('pt-PT', { timeZone: 'Africa/Maputo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
        <span>{(o.price_cents / 100).toLocaleString('pt-PT', { minimumFractionDigits: 2 })} MT</span>
      </div>
    </div>
  );
}

/** Mostra o carregamento, o erro ou o conteúdo. */
export function Loaded<T>({ q, children }: { q: { data: T | null; error: ApiError | null; loading: boolean; reload: () => void }; children: (d: T) => ReactNode }) {
  if (q.loading && !q.data) return <Loading />;
  if (q.error && !q.data) return <ErrorBox error={q.error} retry={q.reload} />;
  if (!q.data) return null;
  return <>{children(q.data)}</>;
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <span className={`badge badge-${STATUS_TONE[status] ?? 'muted'}`}>{label ?? STATUS_LABEL[status] ?? status}</span>;
}

export function Badge({ tone = 'muted', children }: { tone?: string; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'ok' | 'bad'; children: ReactNode }) {
  return <div className={`alert alert-${tone}`}>{children}</div>;
}

export function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="tabs" role="tablist">
      {options.map(([k, l]) => (
        <button key={k} role="tab" aria-selected={value === k} className={value === k ? 'tab active' : 'tab'} onClick={() => onChange(k)}>
          {l}
        </button>
      ))}
    </div>
  );
}

/** Janela de confirmação. Com `reasonLabel`, o motivo é obrigatório. */
export function Confirm({
  title, text, reasonLabel, confirmLabel = 'Confirmar', danger, onConfirm, onClose, children,
}: {
  title: string; text?: string; reasonLabel?: string; confirmLabel?: string; danger?: boolean;
  onConfirm: (reason: string) => Promise<unknown>; onClose: () => void; children?: ReactNode;
}) {
  const [reason, setReason] = useState('');
  const a = useAction();
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {text && <p>{text}</p>}
        {children}
        {reasonLabel && (
          <Field label={reasonLabel}>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} autoFocus />
          </Field>
        )}
        <ErrorBox error={a.error} />
        <div className="row-end">
          <Button kind="ghost" onClick={onClose}>
            Voltar
          </Button>
          <Button
            kind={danger ? 'danger' : 'primary'}
            busy={a.busy}
            disabled={!!reasonLabel && reason.trim().length < 3}
            onClick={async () => {
              const ok = await a.run(() => onConfirm(reason.trim()));
              if (ok !== undefined) onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function KV({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="kv">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Timeline({ events }: { events: { to_status: string; note?: string | null; created_at: string; actor?: string | null }[] }) {
  return (
    <ol className="timeline">
      {events.map((e, i) => (
        <li key={i}>
          <span className="dot" />
          <div>
            <strong>{STATUS_LABEL[e.to_status] ?? e.to_status}</strong>
            <small>
              {new Date(e.created_at).toLocaleString('pt-PT', { timeZone: 'Africa/Maputo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
              {e.actor ? ` · ${e.actor}` : ''}
            </small>
            {e.note && <p>{e.note}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
