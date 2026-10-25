import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from '../shared/brand';
import { MapView } from '../shared/map';
import { useSession } from '../shared/session';
import { Button, Field, Notice, Sheet } from '../shared/ui';

export interface Point {
  lat: number;
  lon: number;
  text: string;
}

interface Base {
  lat: number;
  lon: number;
  label: string;
}

interface Address {
  id: string;
  label: string;
  description: string;
  lat: number;
  lon: number;
}

type Which = 'pickup' | 'dropoff';

/** Escolha de recolha (A) e entrega (B) num só mapa: toque numa linha e depois pesquise, escolha uma morada guardada ou toque no mapa. */
export function RoutePicker({
  onChange, onBack, onNext, header, initialDropoffId,
}: {
  onChange: (pickup: Point | null, dropoff: Point | null) => void;
  onBack: () => void;
  onNext: () => void;
  header?: ReactNode;
  initialDropoffId?: string | null;
}) {
  const { api } = useSession();
  const [active, setActive] = useState<Which>('pickup');
  const [bases, setBases] = useState<Record<Which, Base | null>>({ pickup: null, dropoff: null });
  const [refs, setRefs] = useState<Record<Which, string>>({ pickup: '', dropoff: '' });
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ label: string; lat: number; lon: number }[]>([]);
  const [saved, setSaved] = useState<Address[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const point = (k: Which): Point | null => {
    const b = bases[k];
    if (!b) return null;
    const r = refs[k].trim();
    return { lat: b.lat, lon: b.lon, text: r ? `${r}, ${b.label}` : b.label };
  };

  useEffect(() => {
    onChange(point('pickup'), point('dropoff'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bases, refs]);

  useEffect(() => {
    api
      .get<Address[]>('/addresses')
      .then((list) => {
        setSaved(list);
        const first = initialDropoffId ? list.find((a) => a.id === initialDropoffId) : null;
        if (first) setBases((b) => ({ ...b, dropoff: { lat: first.lat, lon: first.lon, label: first.description } }));
      })
      .catch(() => setSaved([]));
  }, [api, initialDropoffId]);

  useEffect(() => {
    if (q.trim().length < 3) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      api.get(`/places?q=${encodeURIComponent(q.trim())}`).then(setResults).catch((e) => setMsg(e.message));
    }, 450);
    return () => clearTimeout(t);
  }, [q, api]);

  const set = (which: Which, b: Base) => {
    setBases((x) => ({ ...x, [which]: b }));
    setRefs((x) => ({ ...x, [which]: '' }));
    setResults([]);
    setQ('');
    // Depois da recolha, passa logo para a entrega.
    if (which === 'pickup' && !bases.dropoff) setActive('dropoff');
  };

  const choose = async (lat: number, lon: number, label?: string) => {
    setMsg(null);
    if (label) return set(active, { lat, lon, label });
    try {
      const r = await api.get<{ label: string; coverage: { ok: boolean; reason?: string } }>(`/places/reverse?lat=${lat}&lon=${lon}`);
      if (!r.coverage.ok) setMsg(r.coverage.reason ?? 'Fora da zona de cobertura.');
      set(active, { lat, lon, label: r.label });
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const here = () => {
    if (!navigator.geolocation) return setMsg('Este dispositivo não indica a localização.');
    navigator.geolocation.getCurrentPosition(
      (p) => void choose(p.coords.latitude, p.coords.longitude),
      () => setMsg('Não foi possível obter a localização. Autorize o acesso ou toque no mapa.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const a = point('pickup');
  const b = point('dropoff');
  const row = (k: Which, mark: string, title: string, empty: string) => {
    const p = point(k);
    return (
      <button type="button" className={`route-row ${active === k ? 'active' : ''}`} onClick={() => setActive(k)}>
        <span className={`mk ${mark.toLowerCase()}`}>{mark}</span>
        <span className="txt">
          <small>{title}</small>
          <span className={p ? '' : 'empty'}>{p ? p.text : empty}</span>
        </span>
        {p && (
          <span
            role="button"
            tabIndex={0}
            aria-label={`Limpar ${title.toLowerCase()}`}
            onClick={(e) => {
              e.stopPropagation();
              setBases((x) => ({ ...x, [k]: null }));
              setActive(k);
            }}
            onKeyDown={(e) => e.key === 'Enter' && setBases((x) => ({ ...x, [k]: null }))}
          >
            <Icon name="close" size={18} />
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="map-screen">
      <MapView
        height="52vh"
        markers={[...(a ? [{ lat: a.lat, lon: a.lon, kind: 'pickup' as const }] : []), ...(b ? [{ lat: b.lat, lon: b.lon, kind: 'dropoff' as const }] : [])]}
        onClick={(lat, lon) => void choose(lat, lon)}
        padBottom={120}
      />
      <div className="map-top">
        <button type="button" className="round-btn" aria-label="Voltar" onClick={onBack}>
          <Icon name="back" />
        </button>
        <button type="button" className="round-btn" aria-label="Usar a minha localização" onClick={here}>
          <Icon name="target" />
        </button>
      </div>
      <Sheet>
        {header}
        <div className="route-rows">
          {row('pickup', 'A', 'Recolha', 'De onde sai a encomenda?')}
          {row('dropoff', 'B', 'Entrega', 'Para onde vai?')}
        </div>
        <Field label={active === 'pickup' ? 'Pesquisar local de recolha' : 'Pesquisar local de entrega'}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Mercado Central, Av. Julius Nyerere..." autoComplete="off" />
        </Field>
        {results.length > 0 && (
          <div className="place-list">
            {results.map((r, i) => (
              <button key={i} type="button" className="place-row" onClick={() => choose(r.lat, r.lon, r.label)}>
                <span className="ico">
                  <Icon name="pin" size={18} />
                </span>
                <span className="txt">{r.label}</span>
              </button>
            ))}
          </div>
        )}
        {results.length === 0 && saved.length > 0 && (
          <div className="quick">
            {saved.map((s) => (
              <button key={s.id} type="button" className="chip" onClick={() => choose(s.lat, s.lon, s.description)}>
                {s.label}
              </button>
            ))}
          </div>
        )}
        <small className="sub">Também pode tocar no mapa para marcar o ponto exacto.</small>
        {msg && <Notice tone="warn">{msg}</Notice>}
        {bases[active] && (
          <Field label="Referência (casa, cor do portão, ponto conhecido)">
            <input value={refs[active]} onChange={(e) => setRefs((x) => ({ ...x, [active]: e.target.value }))} maxLength={120} />
          </Field>
        )}
        <Notice>Entregas só em Quelimane, até 15 km por estrada.</Notice>
        <div className="sticky-cta">
          <Button disabled={!a || !b} onClick={onNext}>
            Continuar
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
