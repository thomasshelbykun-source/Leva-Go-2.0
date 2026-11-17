import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { newIdempotencyKey } from '../shared/api';
import { useConfig } from '../shared/config';
import { isMzPhone, mt } from '../shared/format';
import { useSession } from '../shared/session';
import { Button, ButtonLink, Card, ErrorBox, Field, KV, Loaded, Notice, Page, useAction, useLoad } from '../shared/ui';

interface Intent {
  id: string;
  provider: string;
  status: 'pending' | 'succeeded' | 'failed' | 'refunded';
  amount_cents: number;
  failure_reason?: string | null;
  order_id?: string | null;
  subscription_id?: string | null;
  manual_txn_ref?: string | null;
  manual?: { provider_label: string; number: string; account_name: string; amount_cents: number; reference: string } | null;
}

/** O que se paga: uma encomenda ou um plano. Os dois têm valor, estado e o último pagamento. */
interface Payable {
  title: string;
  amount_cents: number;
  awaiting: boolean;
  closed_message: string | null;
  payment: { id: string; status: string } | null;
}

const LABEL: Record<string, string> = { mpesa: 'M-Pesa', emola: 'e-Mola', sandbox: 'Pagamento de teste (simulado)' };

/** Pagamento de uma encomenda (/pagar/:id) ou subscrição (/pagar-plano/:id). Pagamentos manuais: nunca pede o PIN. */
export function Payment({ kind }: { kind: 'order' | 'subscription' }) {
  const { id } = useParams();
  const [search] = useSearchParams();
  const { api, me } = useSession();
  const cfg = useConfig();
  const nav = useNavigate();
  const [intent, setIntent] = useState<Intent | null>(null);

  // Carrega o pedido (ou o plano) e, se já houver um pagamento aberto, retoma-o em vez de criar outro.
  const target = useLoad(async (): Promise<Payable> => {
    if (kind === 'order') {
      const o = await api.get<any>(`/orders/${id}`);
      const p: Payable = {
        title: `Encomenda ${o.code}`,
        amount_cents: o.price_cents,
        awaiting: o.status === 'AGUARDA_PAGAMENTO',
        closed_message: o.status === 'AGUARDA_PAGAMENTO' ? null : o.status === 'CANCELADO' ? 'Este pedido foi cancelado.' : 'Este pedido já está pago ou não precisa de pagamento.',
        payment: o.payment ?? null,
      };
      return p;
    }
    const s = await api.get<any>(`/subscriptions/${id}`);
    return {
      title: `Plano ${s.plan_name}`,
      amount_cents: s.price_cents,
      awaiting: s.status === 'pending_payment',
      closed_message: s.status === 'pending_payment' ? null : s.status === 'active' ? 'Este plano já está activo.' : 'Este plano já não aguarda pagamento. Escolha de novo em Subscrição.',
      payment: s.payment ?? null,
    };
  }, [id, kind]);

  useEffect(() => {
    const p = target.data?.payment;
    if (!intent && p && (p.status === 'pending' || p.status === 'succeeded')) {
      api
        .get<Intent>(`/payments/intents/${p.id}`)
        .then((i) => (i.status === 'pending' || i.status === 'succeeded') && setIntent(i))
        .catch(() => undefined);
    }
  }, [target.data, intent, api]);

  const options = cfg
    ? ([
        ['mpesa', cfg.payment_methods.mpesa],
        ['emola', cfg.payment_methods.emola],
        ['sandbox', cfg.payment_methods.sandbox],
      ] as const)
        .filter(([, on]) => on)
        .map(([k]) => k)
    : [];
  const wanted = search.get('metodo');
  const [provider, setProvider] = useState(wanted && wanted !== 'na_entrega' ? wanted : '');
  useEffect(() => {
    if (!provider && options.length === 1) setProvider(options[0]!);
  }, [provider, options]);
  const [msisdn, setMsisdn] = useState(me?.phone?.replace('+258', '') ?? '');
  const [idem, setIdem] = useState(newIdempotencyKey);
  const [txn, setTxn] = useState('');
  const a = useAction();

  // Acompanha o estado do pagamento até à confirmação pela equipa LevaGo.
  useEffect(() => {
    if (!intent || intent.status !== 'pending') return;
    const t = setInterval(async () => {
      try {
        setIntent(await api.get<Intent>(`/payments/intents/${intent.id}`));
      } catch {
        /* tenta de novo no próximo ciclo */
      }
    }, 5000);
    return () => clearInterval(t);
  }, [intent, api]);

  useEffect(() => {
    if (intent?.status !== 'succeeded') return;
    const t = setTimeout(() => nav(kind === 'order' ? `/cliente/encomendas/${id}?novo=1` : '/cliente/planos', { replace: true }), 1500);
    return () => clearTimeout(t);
  }, [intent?.status, kind, id, nav]);

  const start = async () => {
    const r = await a.run(() => api.post<Intent>('/payments/intents', { [kind === 'order' ? 'order_id' : 'subscription_id']: id, provider, msisdn }, idem));
    if (r) setIntent(r);
  };

  const sendRef = () =>
    a.run(async () => {
      await api.post(`/payments/intents/${intent!.id}/manual-reference`, { txn_ref: txn.trim() });
      setIntent(await api.get<Intent>(`/payments/intents/${intent!.id}`));
    });

  const simulate = (outcome: 'succeeded' | 'failed') =>
    a.run(async () => {
      await api.post(`/payments/intents/${intent!.id}/simulate`, { outcome });
      setIntent(await api.get<Intent>(`/payments/intents/${intent!.id}`));
    });

  const back = kind === 'order' ? `/cliente/encomendas/${id}` : '/cliente/planos';

  return (
    <Page title="Pagamento" back={back}>
      <Loaded q={target}>
        {(t) => (
          <div className="stack">
            <Card>
              <p>{t.title}</p>
              <div className="price">{mt(t.amount_cents)}</div>
            </Card>

            {!intent && !t.awaiting && (
              <Card className="stack">
                <Notice tone="info">{t.closed_message}</Notice>
                <ButtonLink to={back}>{kind === 'order' ? 'Ver o pedido' : 'Ver planos'}</ButtonLink>
              </Card>
            )}

            {!intent && t.awaiting && (
              <Card className="stack">
                <h3>Como queres pagar?</h3>
                {!cfg && <Notice>A carregar os métodos de pagamento…</Notice>}
                {cfg && options.length === 0 && <Notice tone="warn">Nenhum método de pagamento está activo agora. Contacte o apoio LevaGo.</Notice>}
                {options.map((k) => (
                  <label key={k} className={`cx-pay ${provider === k ? 'cx-pay-on' : ''}`}>
                    <input type="radio" name="p" checked={provider === k} onChange={() => setProvider(k)} />
                    <span>
                      <strong>{LABEL[k]}</strong>
                      <small>{k === 'sandbox' ? 'Só para testes. Não é cobrado dinheiro.' : 'Transferência manual. Mostramos o número e o valor a seguir.'}</small>
                    </span>
                  </label>
                ))}
                <Field
                  label="Número de onde vais transferir"
                  hint="O número da tua carteira móvel. Nunca escrevas o PIN aqui."
                  error={msisdn.length >= 9 && !isMzPhone(msisdn) ? 'Número de Moçambique inválido.' : null}
                >
                  <input inputMode="tel" value={msisdn} maxLength={16} onChange={(e) => setMsisdn(e.target.value)} />
                </Field>
                <ErrorBox error={a.error} />
                <Button busy={a.busy} disabled={!provider || !options.includes(provider as never) || !isMzPhone(msisdn)} onClick={start}>
                  Continuar
                </Button>
              </Card>
            )}

            {intent?.status === 'pending' && intent.manual && (
              <Card className="stack">
                <h3>Transfere pelo {intent.manual.provider_label}</h3>
                <KV
                  items={[
                    ['Número', <strong key="n" className="pay-big">{intent.manual.number}</strong>],
                    ['Nome da conta', intent.manual.account_name || 'LevaGo'],
                    ['Valor', <strong key="v" className="pay-big">{mt(intent.manual.amount_cents)}</strong>],
                    ['Referência', intent.manual.reference],
                  ]}
                />
                {!intent.manual_txn_ref ? (
                  <>
                    <p>Depois de transferir, recebes um SMS com o código da transacção. Escreve esse código aqui.</p>
                    <Field label="Código da transacção" hint="Exemplo: 8KD2XQ71PL. Não escrevas o PIN.">
                      <input value={txn} onChange={(e) => setTxn(e.target.value.replace(/\s/g, ''))} maxLength={24} autoCapitalize="characters" />
                    </Field>
                    <ErrorBox error={a.error} />
                    <Button busy={a.busy} disabled={!/^[A-Za-z0-9.]{6,24}$/.test(txn.trim())} onClick={sendRef}>
                      Enviar código
                    </Button>
                  </>
                ) : (
                  <Notice tone="info">
                    Recebemos o código {intent.manual_txn_ref}. A equipa LevaGo confirma o pagamento no extracto e o pedido avança. Esta página actualiza sozinha. Também recebes uma notificação.
                  </Notice>
                )}
              </Card>
            )}

            {intent?.status === 'pending' && !intent.manual && (
              <Card className="stack center">
                <div className="spinner" />
                <h3>A aguardar confirmação</h3>
                <p>Pagamento de {mt(intent.amount_cents)}.</p>
                {intent.provider === 'sandbox' && (
                  <>
                    <Notice tone="warn">Pagamento de teste: escolha o resultado.</Notice>
                    <div className="row-between">
                      <Button kind="danger" busy={a.busy} onClick={() => simulate('failed')}>
                        Simular falha
                      </Button>
                      <Button busy={a.busy} onClick={() => simulate('succeeded')}>
                        Simular sucesso
                      </Button>
                    </div>
                  </>
                )}
                <ErrorBox error={a.error} />
              </Card>
            )}

            {intent?.status === 'succeeded' && <Notice tone="ok">Pagamento confirmado. Obrigado!</Notice>}
            {intent?.status === 'failed' && (
              <Card className="stack">
                <Notice tone="bad">O pagamento falhou{intent.failure_reason ? `: ${intent.failure_reason}` : '.'}</Notice>
                <Button
                  onClick={() => {
                    setIntent(null);
                    setTxn('');
                    setIdem(newIdempotencyKey());
                    void target.reload(true);
                  }}
                >
                  Tentar de novo
                </Button>
              </Card>
            )}
          </div>
        )}
      </Loaded>
    </Page>
  );
}
