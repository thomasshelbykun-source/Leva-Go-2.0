import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { newIdempotencyKey } from '../shared/api';
import { useConfig } from '../shared/config';
import { CATEGORIES, isMzPhone, km, minutes, mt, todayMaputo } from '../shared/format';
import { Icon } from '../shared/brand';
import { useSession } from '../shared/session';
import { Button, Card, ErrorBox, Field, KV, Notice, Page, useAction, useLoad } from '../shared/ui';
import { BairroField, type Bairro, type BairroPoint } from './Bairros';

interface Quote {
  quote_id: string;
  road_distance_m: number;
  estimated_duration_s: number;
  route_geometry: { type: string; coordinates: [number, number][] } | null;
  breakdown: { base_cents: number; distance_cents: number; weight_cents: number; minimum_adjust_cents: number; subscription_discount_cents?: number; express_supplement_cents?: number; plan_unit?: boolean; express_credit?: boolean; total_cents: number };
  total_cents: number;
  covered_by_subscription: boolean;
  plan_remaining: number;
  service_available_now: boolean;
  hours_message: string | null;
  expires_at: string;
  pricing_version: number;
}

type Step = 'estabelecimento' | 'locais' | 'detalhes' | 'tipo' | 'confirmar';
const STEPS_ENVIO: [Step, string][] = [['locais', 'Locais'], ['detalhes', 'Encomenda'], ['tipo', 'Serviço'], ['confirmar', 'Pagamento']];
const STEPS_RECOLHA: [Step, string][] = [['estabelecimento', 'Onde'], ['locais', 'Locais'], ['detalhes', 'Entrega'], ['tipo', 'Serviço'], ['confirmar', 'Pagamento']];
const WEIGHTS: [string, string][] = [['1', '≤ 1 kg'], ['5', '≤ 5 kg'], ['10', '≤ 10 kg']];
const PAY_LABEL: Record<string, string> = { mpesa: 'M-Pesa', emola: 'e-Mola', na_entrega: 'Pagar na entrega (dinheiro)', sandbox: 'Pagamento de teste (simulado)' };
const PAY_HINT: Record<string, string> = {
  mpesa: 'Transfere para o número M-Pesa da LevaGo e indicas o código do SMS.',
  emola: 'Transfere para o número e-Mola da LevaGo e indicas o código do SMS.',
  na_entrega: 'Pagas ao estafeta no momento da entrega.',
  sandbox: 'Só para testes. Não é cobrado dinheiro.',
};
const ESTAB: [string, string][] = [['restaurante', 'Restaurante'], ['farmacia', 'Farmácia'], ['loja', 'Loja / Mercado'], ['outro', 'Outro']];

// Pedido a meio: fica guardado no aparelho durante 3 h, para continuar depois de sair da app.
const DRAFT_HOURS = 3;
interface Draft {
  saved: number;
  step: Step;
  est: { establishment_type: string; establishment_name: string; order_ref: string; paid_confirmed: boolean };
  pickup: BairroPoint | null;
  dropoff: BairroPoint | null;
  otherWeight: boolean;
  d: Record<string, any>;
  service: 'normal' | 'expressa';
  when: 'agora' | 'agendar';
  date: string;
}
const draftKey = (userId: string | undefined, recolha: boolean) => `levago.cliente.rascunho.${userId ?? 'anon'}.${recolha ? 'recolha' : 'envio'}`;
function readDraft(key: string): Draft | null {
  try {
    const raw = localStorage.getItem(key);
    const dr = raw ? (JSON.parse(raw) as Draft) : null;
    if (!dr || Date.now() - dr.saved > DRAFT_HOURS * 3_600_000) return null;
    return dr;
  } catch {
    return null;
  }
}
function dropDraft(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* sem armazenamento */
  }
}

/** Solicitar entrega: locais → encomenda → modalidade e agendamento → preço e confirmação. */
export function NewOrder() {
  const { api, me } = useSession();
  const nav = useNavigate();
  const cfg = useConfig();
  const [params] = useSearchParams();
  const recolha = params.get('tipo') === 'recolha';
  const STEPS = recolha ? STEPS_RECOLHA : STEPS_ENVIO;
  const home = useLoad(() => api.get<any>('/home'), []);
  const plan = home.data && !home.data.needs_plan ? home.data.subscription : null;
  const supplement = home.data?.express_supplement_cents ?? 15000;
  const key = draftKey(me?.id, recolha);
  // O preço tem prazo: um pedido guardado no passo do pagamento volta ao passo do serviço.
  const [draft] = useState(() => readDraft(key));
  const [restored, setRestored] = useState(!!draft);
  const [step, setStep] = useState<Step>(draft ? (draft.step === 'confirmar' ? 'tipo' : draft.step) : recolha ? 'estabelecimento' : 'locais');
  const [est, setEst] = useState(draft?.est ?? { establishment_type: 'restaurante', establishment_name: '', order_ref: '', paid_confirmed: false });
  const bairros = useLoad(() => api.get<Bairro[]>('/bairros'), []);
  const [pickup, setPickup] = useState<BairroPoint | null>(draft?.pickup ?? null);
  const [dropoff, setDropoff] = useState<BairroPoint | null>(draft?.dropoff ?? null);
  const [otherWeight, setOtherWeight] = useState(draft?.otherWeight ?? false);
  // Na recolha, a entrega é para o próprio cliente: os dados vêm preenchidos.
  const blank = {
    weight_kg: recolha ? '2' : '', category: recolha ? 'compras' : 'documentos', description: '',
    recipient_name: recolha ? me?.name ?? '' : '', recipient_phone: recolha ? (me?.phone ?? '').replace(/^\+?258/, '') : '', pickup_contact: '', notes: '',
    quantity: '1', declared_value: '', fragile: false, declaration: false,
  };
  const [d, setD] = useState<typeof blank>(draft ? { ...blank, ...draft.d } : blank);
  const [service, setService] = useState<'normal' | 'expressa'>(draft?.service ?? 'normal');
  const [when, setWhen] = useState<'agora' | 'agendar'>(draft?.when === 'agendar' && draft.date >= todayMaputo() ? 'agendar' : 'agora');
  const [date, setDate] = useState(draft && draft.date >= todayMaputo() ? draft.date : todayMaputo());
  const [slot, setSlot] = useState<string | null>(null);
  const [slots, setSlots] = useState<{ start: string; label: string; available: boolean }[] | null>(null);
  const [slotMsg, setSlotMsg] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [method, setMethod] = useState<string>('');
  const [idem] = useState(newIdempotencyKey);
  const a = useAction();

  // Guarda o pedido a cada alteração.
  useEffect(() => {
    const untouched = !pickup && !dropoff && !d.description && !d.recipient_name.trim() && !est.establishment_name;
    try {
      if (untouched) return;
      const dr: Draft = { saved: Date.now(), step, est, pickup, dropoff, otherWeight, d, service, when, date };
      localStorage.setItem(key, JSON.stringify(dr));
    } catch {
      /* sem armazenamento: o pedido não fica guardado */
    }
  }, [key, step, est, pickup, dropoff, otherWeight, d, service, when, date]);

  const startOver = () => {
    dropDraft(key);
    window.location.reload();
  };
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
      api.post<Quote>('/quotes', {
        pickup: { bairro_id: pickup!.bairro.id, reference: pickup!.reference.trim() || undefined },
        dropoff: { bairro_id: dropoff!.bairro.id, reference: dropoff!.reference.trim() || undefined },
        weight_kg: weight,
        service_type: service,
        scheduled_at: when === 'agendar' ? slot : null,
      }),
    );
    if (q) {
      setQuote(q);
      // Com um só método activo, fica já escolhido.
      const on = methods.filter(([, , ok]) => ok);
      setMethod(q.total_cents === 0 ? 'subscricao' : on.length === 1 ? on[0]![0] : '');
      setStep('confirmar');
    }
  };

  const confirm = async () => {
    const o = await a.run(() =>
      api.post<{ id: string; status: string; delivery_code: string; pickup_code?: string | null }>(
        '/orders',
        {
          quote_id: quote!.quote_id, recipient_name: d.recipient_name.trim(), recipient_phone: d.recipient_phone.trim(), pickup_contact: d.pickup_contact.trim() || undefined,
          category: d.category, description: d.description, notes: d.notes || undefined, payment_method: method,
          quantity: Math.max(1, Math.min(50, parseInt(d.quantity, 10) || 1)), fragile: d.fragile, declaration_accepted: d.declaration,
          declared_value_mt: d.declared_value.trim() ? Number(d.declared_value.replace(',', '.')) : null,
          ...(recolha
            ? { order_kind: 'recolha', pickup_details: { establishment_type: est.establishment_type, establishment_name: est.establishment_name.trim(), order_ref: est.order_ref.trim() || undefined, paid_confirmed: est.paid_confirmed } }
            : {}),
        },
        idem,
      ),
    );
    if (!o) return;
    dropDraft(key);
    try {
      sessionStorage.setItem(`levago.code.${o.id}`, o.delivery_code);
      if (o.pickup_code) sessionStorage.setItem(`levago.pickup.${o.id}`, o.pickup_code);
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

  const stepIndex = STEPS.findIndex((s) => s[0] === step);
  const phoneOk = isMzPhone(d.recipient_phone);
  const detailsOk = d.declaration && weight > 0 && weight <= maxKg && d.description.trim().length >= 3 && d.recipient_name.trim().length >= 2 && phoneOk;

  return (
    <Page title={recolha ? 'Pedir recolha' : 'Nova encomenda'} back="/cliente" onBack={stepIndex > 0 ? () => setStep(STEPS[stepIndex - 1][0]) : undefined} className="page-cx">
      <ol className="cx-steps">
        {STEPS.map(([k, l], i) => (
          <li key={k} className={k === step ? 'current' : stepIndex > i ? 'done' : ''}>
            <span className="cx-step-n">{i + 1}</span>
            <span className="cx-step-l">{l}</span>
          </li>
        ))}
      </ol>
      {restored && (
        <Notice tone="info">
          Continuámos o pedido que deixou a meio.{' '}
          <button type="button" className="link" onClick={startOver}>
            Começar de novo
          </button>{' '}
          <button type="button" className="link" aria-label="Fechar aviso" onClick={() => setRestored(false)}>
            ✕
          </button>
        </Notice>
      )}
      {cfg && !cfg.pricing_published && <Notice tone="warn">Ainda não existe tabela de preços publicada. Não é possível pedir entregas por agora.</Notice>}

      {step === 'estabelecimento' && (
        <Card className="stack">
          <h3>Onde vamos buscar?</h3>
          <div className="grid-2">
            {ESTAB.map(([k, l]) => (
              <button key={k} type="button" className={est.establishment_type === k ? 'chip active' : 'chip'} onClick={() => setEst({ ...est, establishment_type: k })}>
                {l}
              </button>
            ))}
          </div>
          <Field label="Nome do estabelecimento">
            <input value={est.establishment_name} maxLength={80} onChange={(e) => setEst({ ...est, establishment_name: e.target.value })} placeholder="Ex.: Farmácia Central" />
          </Field>
          <Field label="Número do pedido (opcional)">
            <input value={est.order_ref} maxLength={40} onChange={(e) => setEst({ ...est, order_ref: e.target.value })} />
          </Field>
          <label className="radio">
            <input type="checkbox" checked={est.paid_confirmed} onChange={(e) => setEst({ ...est, paid_confirmed: e.target.checked })} /> Confirmo que o artigo já está pago ou reservado.
          </label>
          <Notice>O estafeta não paga compras. Ele só recolhe e entrega.</Notice>
          <Button disabled={est.establishment_name.trim().length < 2 || !est.paid_confirmed} onClick={() => setStep('locais')}>
            Continuar
          </Button>
        </Card>
      )}

      {step === 'locais' && (
        <div className="ad-step">
          {bairros.error && <ErrorBox error={bairros.error} retry={bairros.reload} />}
          <BairroField
            question={recolha ? 'Em que bairro fica o estabelecimento?' : 'Em que bairro recolhemos?'}
            placeholder="Escreve o nome do bairro"
            bairros={bairros.data ?? []}
            value={pickup}
            onChange={setPickup}
          />
          <BairroField question="Em que bairro entregamos?" placeholder="Escreve o nome do bairro" bairros={bairros.data ?? []} value={dropoff} onChange={setDropoff} />
          {bairros.loading && <small className="cx-note">A carregar os bairros…</small>}
          <button type="button" className="cx-continue" disabled={!pickup || !dropoff} onClick={() => setStep('detalhes')}>
            Continuar <Icon name="arrowRight" size={26} />
          </button>
        </div>
      )}

      {step === 'detalhes' && (
        <div className="stack">
          <h2 className="cx-h">{recolha ? 'Dados da recolha' : 'Dados da encomenda'}</h2>
          <Field label="Peso aproximado" error={d.weight_kg && !(weight > 0 && weight <= maxKg) ? `O peso tem de estar entre 0,1 e ${maxKg} kg.` : null}>
            <div className="chips" role="radiogroup" aria-label="Peso aproximado">
              {WEIGHTS.map(([k, l]) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={!otherWeight && d.weight_kg === k}
                  className={!otherWeight && d.weight_kg === k ? 'chip active' : 'chip'}
                  onClick={() => {
                    setOtherWeight(false);
                    setD({ ...d, weight_kg: k });
                  }}
                >
                  {l}
                </button>
              ))}
              <button
                type="button"
                role="radio"
                aria-checked={otherWeight}
                className={otherWeight ? 'chip active' : 'chip'}
                onClick={() => {
                  setOtherWeight(true);
                  setD({ ...d, weight_kg: '' });
                }}
              >
                Outro
              </button>
            </div>
            {otherWeight && (
              <input inputMode="decimal" autoFocus placeholder={`Peso em kg (até ${maxKg})`} value={d.weight_kg} onChange={(e) => setD({ ...d, weight_kg: e.target.value })} />
            )}
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
          <Field label={recolha ? 'O que vamos recolher?' : 'O que vais enviar?'} error={d.description && d.description.trim().length < 3 ? 'Escreve pelo menos 3 letras.' : null}>
            <input value={d.description} maxLength={300} onChange={(e) => setD({ ...d, description: e.target.value })} placeholder="Ex.: Envelope" />
          </Field>
          <div className="field">
            <span className="field-label">Quem vai receber?</span>
            <label className="ad-input">
              <Icon name="user" />
              <input value={d.recipient_name} maxLength={80} placeholder="Nome de quem recebe" aria-label="Nome de quem recebe" onChange={(e) => setD({ ...d, recipient_name: e.target.value })} />
            </label>
            <label className="ad-input">
              <Icon name="phone" />
              <input inputMode="tel" value={d.recipient_phone} maxLength={16} placeholder="84 123 4567" aria-label="Telemóvel de quem recebe" onChange={(e) => setD({ ...d, recipient_phone: e.target.value })} />
            </label>
            {d.recipient_phone.trim().length >= 9 && !phoneOk && <span className="field-error">Número de Moçambique inválido (ex.: 84 123 4567).</span>}
          </div>
          <Field label="Observações (opcional)">
            <textarea rows={2} maxLength={500} value={d.notes} placeholder="Ex.: Ter cuidado" onChange={(e) => setD({ ...d, notes: e.target.value })} />
          </Field>
          <label className="radio">
            <input type="checkbox" checked={d.fragile} onChange={(e) => setD({ ...d, fragile: e.target.checked })} /> Conteúdo frágil
          </label>
          <label className="radio">
            <input type="checkbox" checked={d.declaration} onChange={(e) => setD({ ...d, declaration: e.target.checked })} /> Declaro que o conteúdo é permitido e vai bem embalado (sem dinheiro, armas, drogas, animais ou produtos perigosos).
          </label>
          <button type="button" className="cx-continue cx-continue-block" disabled={!detailsOk} onClick={() => setStep('tipo')}>
            Continuar
          </button>
        </div>
      )}

      {step === 'tipo' && (
        <div className="stack">
          <h2 className="cx-h">Quando desejas a entrega?</h2>
          <div className="grid-2 cx-when">
            <button type="button" className={`cx-option ${when === 'agora' ? 'cx-option-on' : ''}`} aria-pressed={when === 'agora'} onClick={() => setWhen('agora')}>
              <span className="cx-radio" aria-hidden />
              <span>
                <strong>Agora</strong>
                <small>Recolha e entrega hoje</small>
              </span>
            </button>
            <button
              type="button"
              className={`cx-option ${when === 'agendar' ? 'cx-option-on' : ''}`}
              aria-pressed={when === 'agendar'}
              onClick={() => {
                setWhen('agendar');
                if (!slots) void loadSlots(date);
              }}
            >
              <Icon name="calendar" />
              <span>
                <strong>Agendar</strong>
                <small>Escolher data e hora</small>
              </span>
            </button>
          </div>
          {when === 'agora' && cfg && !cfg.open_now && <Notice tone="warn">Estamos fora do horário de serviço. Pode agendar para outro horário.</Notice>}
          {when === 'agendar' && (
            <Card className="stack">
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
            </Card>
          )}
          <h2 className="cx-h">Tipo de entrega</h2>
          {(['normal', 'expressa'] as const).map((s) => (
            <button key={s} type="button" className={`cx-service ${s === 'expressa' ? 'cx-service-x' : ''} ${service === s ? 'cx-service-on' : ''}`} aria-pressed={service === s} onClick={() => setService(s)}>
              <span className="cx-service-icon">
                <Icon name={s === 'normal' ? 'box' : 'bolt'} size={34} />
              </span>
              <span className="cx-service-text">
                <strong>{s === 'normal' ? 'Normal' : 'Expressa'}</strong>
                {s === 'normal' ? (
                  <small>
                    Previsão: de 1 – 3 horas
                    <br />
                    {plan ? '(sem custo adicional)' : '(tarifa normal)'}
                  </small>
                ) : (
                  <small>
                    Previsão: de 15 min a 1 hora
                    <br />
                    Prioridade máxima
                  </small>
                )}
                {s === 'expressa' && <em className="cx-service-plus">{plan ? `+ ${mt(supplement)}` : 'Tarifa expressa'}</em>}
              </span>
              <span className="cx-radio" aria-hidden />
            </button>
          ))}
          {plan && (
            <Notice>
              Será descontada 1 encomenda do teu plano ({plan.remaining} disponíveis).
              {service === 'expressa' && home.data?.express_credits > 0 && ' Tens um crédito expresso: o suplemento fica pago.'}
            </Notice>
          )}
          <Notice>
            <Icon name="info" size={18} /> A previsão inclui a atribuição do estafeta, a recolha e a entrega.
          </Notice>
          <ErrorBox error={a.error} />
          <div className="row-between">
            <Button kind="ghost" onClick={() => setStep('detalhes')}>
              Voltar
            </Button>
            <button type="button" className="cx-continue cx-continue-inline" disabled={a.busy || (when === 'agendar' && !slot)} onClick={getQuote}>
              {a.busy ? 'Aguarde…' : 'Continuar'}
            </button>
          </div>
        </div>
      )}

      {step === 'confirmar' && quote && (
        <div className="stack">
          <Card>
            <h3>Resumo</h3>
            <KV
              items={[
                ...(recolha ? ([['Recolha em', est.establishment_name]] as [string, string][]) : []),
                ['De', `${pickup!.bairro.name}${pickup!.reference.trim() ? ` (${pickup!.reference.trim()})` : ''}`],
                ['Para', `${dropoff!.bairro.name}${dropoff!.reference.trim() ? ` (${dropoff!.reference.trim()})` : ''}`],
                ['Quem recebe', `${d.recipient_name.trim()} · ${d.recipient_phone.trim()}`],
                ['Peso', `${String(weight).replace('.', ',')} kg`],
                ['Modalidade', service === 'normal' ? 'Normal' : 'Expressa'],
                ['Quando', when === 'agora' ? 'Agora' : (slots?.find((x) => x.start === slot)?.label ?? 'Agendado')],
                ['Distância aproximada', km(quote.road_distance_m)],
                ['Tempo estimado', minutes(quote.estimated_duration_s)],
              ]}
            />
          </Card>
          {quote.breakdown.plan_unit ? (
            <Card>
              <KV
                items={[
                  ['Encomendas do plano', `1 (ficam ${Math.max(0, quote.plan_remaining - 1)})`],
                  ...(service === 'expressa'
                    ? ([['Suplemento Expressa', quote.breakdown.express_credit ? 'Pago com crédito expresso' : mt(quote.breakdown.express_supplement_cents ?? supplement)]] as [string, string][])
                    : []),
                ]}
              />
              <div className="row-between">
                <strong>Total a pagar</strong>
                <div className="price">{mt(quote.total_cents)}</div>
              </div>
            </Card>
          ) : (
            <Card>
              <KV
                items={[
                  ['Taxa base', mt(quote.breakdown.base_cents)],
                  ['Distância', mt(quote.breakdown.distance_cents)],
                  ['Peso', mt(quote.breakdown.weight_cents)],
                  ...(quote.breakdown.minimum_adjust_cents ? ([['Ajuste ao mínimo', mt(quote.breakdown.minimum_adjust_cents)]] as [string, string][]) : []),
                  ...(quote.covered_by_subscription ? ([['Coberto pela subscrição', `− ${mt(quote.breakdown.subscription_discount_cents)}`]] as [string, string][]) : []),
                ]}
              />
              <div className="row-between">
                <strong>Total a pagar</strong>
                <div className="price">{mt(quote.total_cents)}</div>
              </div>
              <small>Preço válido até {new Date(quote.expires_at).toLocaleTimeString('pt-PT', { timeZone: 'Africa/Maputo', hour: '2-digit', minute: '2-digit' })}.</small>
            </Card>
          )}
          {!quote.service_available_now && <Notice tone="warn">{quote.hours_message} Volte atrás e agende para outro horário.</Notice>}
          {quote.total_cents > 0 && (
            <Card className="stack">
              <h3>Como queres pagar?</h3>
              {methods.filter(([, , on]) => on).length === 0 && <Notice tone="warn">Nenhum método de pagamento está activo agora. Contacte o apoio LevaGo.</Notice>}
              {methods
                .filter(([, , on]) => on)
                .map(([k]) => (
                  <label key={k} className={`cx-pay ${method === k ? 'cx-pay-on' : ''}`}>
                    <input type="radio" name="metodo" checked={method === k} onChange={() => setMethod(k)} />
                    <span>
                      <strong>{PAY_LABEL[k]}</strong>
                      <small>{PAY_HINT[k]}</small>
                    </span>
                  </label>
                ))}
            </Card>
          )}
          <Notice>Depois de confirmar, recebes 2 códigos. O código de recolha é para quem entrega a encomenda ao estafeta. O código de entrega é só para quem recebe. Não partilhes os códigos antes da hora.</Notice>
          <ErrorBox error={a.error} />
          <div className="row-between">
            <Button kind="ghost" onClick={() => setStep('tipo')}>
              Voltar
            </Button>
            <button type="button" className="cx-continue cx-continue-inline" disabled={a.busy || !method || !quote.service_available_now} onClick={confirm}>
              {a.busy ? 'Aguarde…' : quote.total_cents > 0 && method !== 'na_entrega' ? 'Confirmar e pagar' : 'Confirmar pedido'}
            </button>
          </div>
        </div>
      )}
    </Page>
  );
}
