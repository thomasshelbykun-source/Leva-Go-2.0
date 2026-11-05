import { useEffect, useState } from 'react';
import { MapView } from '../shared/map';
import { IN_APP } from '../shared/inapp';
import { useSession } from '../shared/session';
import { Button, Field, Notice } from '../shared/ui';
import { Icon } from '../shared/brand';

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
      () => setMsg('Não foi possível obter a localização. Autorize o acesso ou escreva o endereço.'),
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
        <small>{IN_APP ? 'Escreva o endereço e escolha uma sugestão.' : 'Toque no mapa para marcar o ponto exacto.'}</small>
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

/** Morada vinda de fora (moradas salvas). O número muda a cada escolha. */
export interface Preset {
  lat: number;
  lon: number;
  label: string;
  n: number;
}

/**
 * Campo de morada ao estilo dos mockups de 2026-11-05: pesquisa com pino,
 * "Usar a minha localização" (só na recolha) e "Selecionar no mapa" (só no site; o APK não tem mapa).
 */
export function AddressField({
  question, placeholder, kind, onChange, preset,
}: { question: string; placeholder: string; kind: 'pickup' | 'dropoff'; onChange: (p: Point | null) => void; preset?: Preset | null }) {
  const { api } = useSession();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ label: string; lat: number; lon: number }[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [ref, setRef] = useState('');
  const [map, setMap] = useState(false);
  const [busy, setBusy] = useState(false);
  const [base, setBase] = useState<{ lat: number; lon: number; label: string } | null>(null);

  useEffect(() => {
    if (preset) {
      setBase({ lat: preset.lat, lon: preset.lon, label: preset.label });
      setQ('');
      setResults([]);
      setMsg(null);
    }
  }, [preset]);

  useEffect(() => {
    if (base || q.trim().length < 3) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      api.get(`/places?q=${encodeURIComponent(q.trim())}`).then(setResults).catch((e) => setMsg(e.message));
    }, 450);
    return () => clearTimeout(t);
  }, [q, api, base]);

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
    setBusy(true);
    try {
      const r = await api.get<{ label: string; coverage: { ok: boolean; reason?: string } }>(`/places/reverse?lat=${lat}&lon=${lon}`);
      if (!r.coverage.ok) setMsg(r.coverage.reason ?? 'Fora da zona de cobertura.');
      setBase({ lat, lon, label: r.label });
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const here = () => {
    if (!navigator.geolocation) return setMsg('Este dispositivo não indica a localização.');
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (p) => void choose(p.coords.latitude, p.coords.longitude),
      () => {
        setBusy(false);
        setMsg('Não foi possível obter a localização. Autorize o acesso ou escreva o endereço.');
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const clear = () => {
    setBase(null);
    setRef('');
    setQ('');
  };

  return (
    <section className="ad">
      <h3 className="ad-q">{question}</h3>
      <div className={`ad-input ${base ? 'ad-filled' : ''}`}>
        <Icon name="pin" size={24} />
        {base ? (
          <span className="ad-value">{base.label}</span>
        ) : (
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={question} />
        )}
        {base && (
          <button type="button" className="ad-clear" aria-label="Limpar morada" onClick={clear}>
            <Icon name="close" size={18} />
          </button>
        )}
      </div>
      {results.length > 0 && (
        <ul className="ad-results">
          {results.map((r, i) => (
            <li key={i}>
              <button type="button" onClick={() => choose(r.lat, r.lon, r.label)}>
                <Icon name="pin" size={18} /> {r.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {(kind === 'pickup' || !IN_APP) && (
        <div className={`ad-actions ${kind === 'pickup' && !IN_APP ? 'ad-two' : ''}`}>
          {kind === 'pickup' && (
            <button type="button" className="ad-btn ad-btn-soft" onClick={here} disabled={busy}>
              <Icon name="crosshair" size={28} />
              <span>{busy ? 'A localizar…' : 'Usar a minha localização'}</span>
            </button>
          )}
          {!IN_APP && (
            <button type="button" className={`ad-btn ${map ? 'ad-btn-on' : ''}`} onClick={() => setMap(!map)}>
              <Icon name="mapFold" size={28} />
              <span>Selecionar no mapa</span>
            </button>
          )}
        </div>
      )}
      {map && !IN_APP && (
        <div className="ad-map">
          <MapView height={220} markers={base ? [{ lat: base.lat, lon: base.lon, kind }] : []} onClick={(lat, lon) => void choose(lat, lon)} />
          <small>Toque no mapa para marcar o ponto exacto.</small>
        </div>
      )}
      {msg && <Notice tone="warn">{msg}</Notice>}
      {base && (
        <input className="ad-ref" value={ref} onChange={(e) => setRef(e.target.value)} maxLength={120} placeholder="Referência (casa, cor do portão, ponto conhecido)" />
      )}
    </section>
  );
}

/** "Moradas salvas": escolhe uma morada guardada para a recolha ou para a entrega. */
export function SavedAddresses({ onPick }: { onPick: (kind: 'pickup' | 'dropoff', a: { lat: number; lon: number; label: string }) => void }) {
  const { api } = useSession();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<Address[] | null>(null);
  useEffect(() => {
    if (open && !saved) api.get<Address[]>('/addresses').then(setSaved).catch(() => setSaved([]));
  }, [open, saved, api]);
  return (
    <div className="ad-saved">
      <button type="button" className="ad-saved-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name="bookmark" size={26} />
        <span>Moradas salvas</span>
        <span className={`ad-chev ${open ? 'ad-chev-open' : ''}`}><Icon name="chevronRight" size={20} /></span>
      </button>
      {open && (
        <ul className="ad-saved-list">
          {saved === null && <li className="small">A carregar…</li>}
          {saved?.length === 0 && <li className="small">Ainda não tens moradas guardadas. Podes guardá-las no Perfil.</li>}
          {saved?.map((a) => (
            <li key={a.id}>
              <span>
                <strong>{a.label}</strong>
                <small>{a.description}</small>
              </span>
              <span className="ad-saved-use">
                <button type="button" onClick={() => onPick('pickup', { lat: a.lat, lon: a.lon, label: a.description })}>Recolha</button>
                <button type="button" onClick={() => onPick('dropoff', { lat: a.lat, lon: a.lon, label: a.description })}>Entrega</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
