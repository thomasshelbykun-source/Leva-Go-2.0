import { useEffect, useState } from 'react';
import { MapView } from '../shared/map';
import { useSession } from '../shared/session';
import { Button, Field, Notice } from '../shared/ui';

export interface Point {
  lat: number;
  lon: number;
  text: string;
}

interface Address {
  id: string;
  label: string;
  description: string;
  lat: number;
  lon: number;
}

/** Escolha de local: morada guardada, pesquisa, toque no mapa ou localização actual. */
export function LocationPicker({ label, value, onChange, kind }: { label: string; value: Point | null; onChange: (p: Point | null) => void; kind: 'pickup' | 'dropoff' }) {
  const { api } = useSession();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ label: string; lat: number; lon: number }[]>([]);
  const [saved, setSaved] = useState<Address[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [ref, setRef] = useState('');
  const [base, setBase] = useState<{ lat: number; lon: number; label: string } | null>(value ? { lat: value.lat, lon: value.lon, label: value.text } : null);

  useEffect(() => {
    api.get<Address[]>('/addresses').then(setSaved).catch(() => setSaved([]));
  }, [api]);

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

  // O texto final junta a morada e a referência dada pelo cliente.
  useEffect(() => {
    if (!base) return onChange(null);
    const text = ref.trim() ? `${ref.trim()}, ${base.label}` : base.label;
    onChange({ lat: base.lat, lon: base.lon, text });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, ref]);

  const choose = async (lat: number, lon: number, lbl?: string) => {
    setMsg(null);
    setResults([]);
    if (lbl) return setBase({ lat, lon, label: lbl });
    try {
      const r = await api.get<{ label: string; coverage: { ok: boolean; reason?: string } }>(`/places/reverse?lat=${lat}&lon=${lon}`);
      if (!r.coverage.ok) setMsg(r.coverage.reason ?? 'Fora da zona de cobertura.');
      setBase({ lat, lon, label: r.label });
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

  return (
    <div className="stack">
      <h3>{label}</h3>
      {saved.length > 0 && (
        <div className="chips">
          {saved.map((a) => (
            <button key={a.id} type="button" className="chip" onClick={() => choose(a.lat, a.lon, a.description)}>
              {a.label}
            </button>
          ))}
        </div>
      )}
      <Field label="Pesquisar morada ou local de referência">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ex.: Mercado Central, Av. Julius Nyerere" />
      </Field>
      {results.length > 0 && (
        <ul className="list">
          {results.map((r, i) => (
            <li key={i}>
              <button type="button" onClick={() => choose(r.lat, r.lon, r.label)}>
                {r.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      <MapView height={220} markers={base ? [{ lat: base.lat, lon: base.lon, kind }] : []} onClick={(lat, lon) => void choose(lat, lon)} />
      <div className="row-between">
        <small>Toque no mapa para marcar o ponto exacto.</small>
        {kind === 'pickup' && (
          <Button type="button" kind="secondary" onClick={here}>
            Usar a minha localização
          </Button>
        )}
      </div>
      {msg && <Notice tone="warn">{msg}</Notice>}
      {base && (
        <Field label="Referência (casa, cor do portão, ponto conhecido)">
          <input value={ref} onChange={(e) => setRef(e.target.value)} maxLength={120} />
        </Field>
      )}
    </div>
  );
}
