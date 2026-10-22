import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { newIdempotencyKey } from '../shared/api';
import { useConfig } from '../shared/config';
import { CATEGORIES, km, minutes, mt, todayMaputo } from '../shared/format';
import { MapView } from '../shared/map';
import { useSession } from '../shared/session';
import { Button, Card, ErrorBox, Field, KV, Notice, Page, useAction } from '../shared/ui';
import { LocationPicker, type Point } from './LocationPicker';

interface Quote {
  quote_id: string;
  road_distance_m: number;
  estimated_duration_s: number;
  route_geometry: { type: string; coordinates: [number, number][] } | null;
  breakdown: { base_cents: number; distance_cents: number; weight_cents: number; minimum_adjust_cents: number; subscription_discount_cents?: number; total_cents: number };
  total_cents: number;
  covered_by_subscription: boolean;
  service_available_now: boolean;
  hours_message: string | null;
  expires_at: string;
  pricing_version: number;
}

type Step = 'locais' | 'detalhes' | 'tipo' | 'confirmar';
const STEPS: [Step, string][] = [['locais', 'Locais'], ['detalhes', 'Encomenda'], ['tipo', 'Serviço'], ['confirmar', 'Preço']];

/** Solicitar entrega: locais → encomenda → modalidade e agendamento → preço e confirmação. */
export function NewOrder() {
  const { api } = useSession();
  const nav = useNavigate();
  const cfg = useConfig();
  const [step, setStep] = useState<Step>('locais');
  const [pickup, setPickup] = useState<Point | null>(null);
  const [dropoff, setDropoff] = useState<Point | null>(null);
  const [d, setD] = useState({ weight_kg: '', category: 'documentos', description: '', recipient_name: '', recipient_phone: '', pickup_contact: '', notes: '' });
  const [service, setService] = useState<'normal' | 'expressa'>('normal');
  const [when, setWhen] = useState<'agora' | 'agendar'>('agora');
  const [date, setDate] = useState(todayMaputo());
  const [slot, setSlot] = useState<string | null>(null);
  const [slots, setSlots] = useState<{ start: string; label: string; available: boolean }[] | null>(null);
  const [slotMsg, setSlotMsg] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [method, setMethod] = useState<string>('');
  const [idem] = useState(newIdempotencyKey);
  const a = useAction();
  const maxKg = cfg?.limits?.max_weight_kg ?? 15;
  const weight = Number(d.weight_kg.replace(',', '.'));

  const loadSlots = async (day: string) => {
    setDate(day);
    setSlot(null);
    setSlots(null);
    try {
      const r = await api.get<{ slots: typeof slots; reason?: string }>(`/slots?date=${day}`);
      setSlots(r.slots ?? []);
      setSlotMsg(r.reason ?? null);
    } catch (e) {
      setSlotMsg((e as Error).message);
    }
  };

  const getQuote = async () => {
    const q = await a.run(() =>
      api.post<Quote>('/quotes', { pickup, dropoff, weight_kg: weight, service_type: service, scheduled_at: when === 'agendar' ? slot : null }),
    );
    if (q) {
      setQuote(q);
      setMethod(q.total_cents === 0 ? 'subscricao' : '');
      setStep('confirmar');
    }
  };

  const confirm = async () => {
    const o = await a.run(() =>
      api.post<{ id: string; status: string; delivery_code: string }>(
        '/orders',
        {
          quote_id: quote!.quote_id, recipient_name: d.recipient_name, recipient_phone: d.recipient_phone, pickup_contact: d.pickup_contact || undefined,
          category: d.category, description: d.description, notes: d.notes || undefined, payment_method: method,
        },
        idem,
      ),
    );
    if (!o) return;
    try {
      sessionStorage.setItem(`levago.code.${o.id}`, o.delivery_code);
    } catch {
      /* sem armazenamento: o código fica nas notificações */
    }
    nav(o.status === 'AGUARDA_PAGAMENTO' ? `/cliente/pagar/${o.id}?metodo=${method}` : `/cliente/encomendas/${o.id}?novo=1`, { replace: true });
  };

  const methods = cfg
    ? ([
        ['mpesa', 'M-Pesa', cfg.payment_methods.mpesa],
        ['emola', 'e-Mola', cfg.payment_methods.emola],
        ['na_entrega', 'Pagar na entrega', cfg.payment_methods.na_entrega],
        ['sandbox', 'Pagamento de teste (simulado)', cfg.payment_methods.sandbox],
      ] as const)
    : [];

  const detailsOk = weight > 0 && weight <= maxKg && d.description.trim().length >= 3 && d.recipient_name.trim().length >= 2 && d.recipient_phone.trim().length >= 9;

  return (
    <Page title="Nova entrega" back="/cliente">
      <ol className="steps">
        {STEPS.map(([k, l], i) => (
          <li key={k} className={k === step ? 'current' : STEPS.findIndex((s) => s[0] === step) > i ? 'done' : ''}>
            {l}
          </li>
        ))}
      </ol>
      {cfg && !cfg.pricing_published && <Notice tone="warn">Ainda não existe tabela de preços publicada. Não é possível pedir entregas por agora.</Notice>}

      {step === 'locais' && (
        <div className="stack">
          <Card>
            <LocationPicker label="Recolha (A)" kind="pickup" value={pickup} onChange={setPickup} />
          </Card>
          <Card>
            <LocationPicker label="Entrega (B)" kind="dropoff" value={dropoff} onChange={setDropoff} />
          </Card>
          <Notice>Entregas só em Quelimane, até 15 km por estrada.</Notice>
          <Button disabled={!pickup || !dropoff} onClick={() => setStep('detalhes')}>
            Continuar
          </Button>
        </div>
      )}

      {step === 'detalhes' && (
        <Card className="stack">
          <Field label={`Peso aproximado (kg, até ${maxKg})`} error={d.weight_kg && !(weight > 0 && weight <= maxKg) ? `O peso tem de estar entre 0,1 e ${maxKg} kg.` : null}>
            <input inputMode="decimal" value={d.weight_kg} onChange={(e) => setD({ ...d, weight_kg: e.target.value })} />
          </Field>
          <Field label="Categoria">
            <select value={d.category} onChange={(e) => setD({ ...d, category: e.target.value })}>
              {Object.entries(CATEGORIES).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="O que vai enviar?">
            <input value={d.description} maxLength={300} onChange={(e) => setD({ ...d, description: e.target.value })} placeholder="Ex.: envelope com documentos" />
          </Field>
          <Field label="Nome de quem recebe">
            <input value={d.recipient_name} onChange={(e) => setD({ ...d, recipient_name: e.target.value })} />
          </Field>
          <Field label="Telemóvel de quem recebe">
            <input inputMode="tel" value={d.recipient_phone} onChange={(e) => setD({ ...d, recipient_phone: e.target.value })} />
          </Field>
          <Field label="Contacto na recolha (opcional)">
            <input inputMode="tel" value={d.pickup_contact} onChange={(e) => setD({ ...d, pickup_contact: e.target.value })} />
          </Field>
          <Field label="Observações para o estafeta (opcional)">
            <textarea rows={2} maxLength={500} value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} />
          </Field>
          <Notice tone="warn">Não envie dinheiro, armas, drogas, animais ou produtos perigosos.</Notice>
          <div className="row-between">
            <Button kind="ghost" onClick={() => setStep('locais')}>
              Voltar
            </Button>
            <Button disabled={!detailsOk} onClick={() => setStep('tipo')}>
              Continuar
            </Button>
          </div>
        </Card>
      )}

      {step === 'tipo' && (
        <div className="stack">
          <div className="grid-2">
            {(['normal', 'expressa'] as const).map((s) => (
              <Card key={s} className={service === s ? 'selected' : ''} onClick={() => setService(s)}>
                <h3>{s === 'normal' ? 'Normal' : 'Expressa'}</h3>
                <p className="small">{s === 'normal' ? 'Prioridade normal.' : 'Prioridade máxima, sujeita a estafetas disponíveis.'}</p>
              </Card>
            ))}
          </div>
          <Card className="stack">
            <h3>Quando?</h3>
            <div className="chips">
              <button type="button" className={when === 'agora' ? 'chip active' : 'chip'} onClick={() => setWhen('agora')}>
                Agora
              </button>
              <button
                type="button"
                className={when === 'agendar' ? 'chip active' : 'chip'}
                onClick={() => {
                  setWhen('agendar');
                  if (!slots) void loadSlots(date);
                }}
              >
                Agendar
              </button>
            </div>
            {when === 'agora' && cfg && !cfg.open_now && <Notice tone="warn">Estamos fora do horário de serviço. Pode agendar para outro horário.</Notice>}
            {when === 'agendar' && (
              <>
                <Field label="Dia">
                  <input type="date" min={todayMaputo()} max={todayMaputo(7)} value={date} onChange={(e) => void loadSlots(e.target.value)} />
                </Field>
                {slotMsg && <Notice tone="warn">{slotMsg}</Notice>}
                {slots && slots.length === 0 && !slotMsg && <Notice>Sem horários livres neste dia.</Notice>}
                <div className="chips">
                  {slots?.map((s) => (
                    <button key={s.start} type="button" disabled={!s.available} className={slot === s.start ? 'chip active' : 'chip'} onClick={() => setSlot(s.start)}>
                      {s.label}
                      {!s.available && ' (cheio)'}
                    </button>
                  ))}
                </div>
              </>
            )}
          </Card>
          <ErrorBox error={a.error} />
          <div className="row-between">
            <Button kind="ghost" onClick={() => setStep('detalhes')}>
              Voltar
            </Button>
            <Button busy={a.busy} disabled={when === 'agendar' && !slot} onClick={getQuote}>
              Ver preço
            </Button>
          </div>
        </div>
      )}

      {step === 'confirmar' && quote && (
        <div className="stack">
          <MapView
            markers={[
              { ...pickup!, kind: 'pickup' },
              { ...dropoff!, kind: 'dropoff' },
            ]}
            route={quote.route_geometry}
          />
          <Card>
            <div className="price">{mt(quote.total_cents)}</div>
            <KV
              items={[
                ['Distância por estrada', km(quote.road_distance_m)],
                ['Tempo estimado', minutes(quote.estimated_duration_s)],
                ['Modalidade', service === 'normal' ? 'Normal' : 'Expressa'],
                ['Taxa base', mt(quote.breakdown.base_cents)],
                ['Distância', mt(quote.breakdown.distance_cents)],
                ['Peso', mt(quote.breakdown.weight_cents)],
                ...(quote.breakdown.minimum_adjust_cents ? ([['Ajuste ao mínimo', mt(quote.breakdown.minimum_adjust_cents)]] as [string, string][]) : []),
                ...(quote.covered_by_subscription ? ([['Coberto pela subscrição', `− ${mt(quote.breakdown.subscription_discount_cents)}`]] as [string, string][]) : []),
              ]}
            />
            <small>Preço válido até {new Date(quote.expires_at).toLocaleTimeString('pt-PT', { timeZone: 'Africa/Maputo', hour: '2-digit', minute: '2-digit' })}.</small>
          </Card>
          {!quote.service_available_now && <Notice tone="warn">{quote.hours_message} Volte atrás e agende para outro horário.</Notice>}
          {quote.total_cents > 0 && (
            <Card className="stack">
              <h3>Pagamento</h3>
              {methods.filter(([, , on]) => on).length === 0 && <Notice tone="warn">Nenhum método de pagamento está activo agora.</Notice>}
              {methods.map(([k, l, on]) => (
                <label key={k} className={`radio ${on ? '' : 'disabled'}`}>
                  <input type="radio" name="metodo" disabled={!on} checked={method === k} onChange={() => setMethod(k)} /> {l}
                  {!on && <small> (em breve)</small>}
                </label>
              ))}
            </Card>
          )}
          <ErrorBox error={a.error} />
          <div className="row-between">
            <Button kind="ghost" onClick={() => setStep('tipo')}>
              Alterar
            </Button>
            <Button busy={a.busy} disabled={!method || !quote.service_available_now} onClick={confirm}>
              Confirmar pedido
            </Button>
          </div>
        </div>
      )}
    </Page>
  );
}
