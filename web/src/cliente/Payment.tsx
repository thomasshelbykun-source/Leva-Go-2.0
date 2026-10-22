import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { newIdempotencyKey } from '../shared/api';
import { useConfig } from '../shared/config';
import { mt } from '../shared/format';
import { useSession } from '../shared/session';
import { Button, Card, ErrorBox, Field, Loaded, Notice, Page, useAction, useLoad } from '../shared/ui';

interface Intent {
  id: string;
  provider: string;
  status: 'pending' | 'succeeded' | 'failed' | 'refunded';
  amount_cents: number;
  failure_reason?: string | null;
  order_id?: string | null;
  subscription_id?: string | null;
}

/** Pagamento de uma encomenda (/pagar/:id) ou subscrição (/pagar-plano/:id). Nunca guarda o PIN. */
export function Payment({ kind }: { kind: 'order' | 'subscription' }) {
  const { id } = useParams();
  const [search] = useSearchParams();
  const { api, me } = useSession();
  const cfg = useConfig();
  const nav = useNavigate();
  const order = useLoad(() => (kind === 'order' ? api.get(`/orders/${id}`) : Promise.resolve(null)), [id]);
  const [provider, setProvider] = useState(search.get('metodo') && search.get('metodo') !== 'na_entrega' ? search.get('metodo')! : '');
  const [msisdn, setMsisdn] = useState(me?.phone?.replace('+258', '') ?? '');
  const [intent, setIntent] = useState<Intent | null>(null);
  const [idem, setIdem] = useState(newIdempotencyKey);
  const a = useAction();

  // Acompanha o estado do pagamento até à confirmação do provedor.
  useEffect(() => {
    if (!intent || intent.status !== 'pending') return;
    const t = setInterval(async () => {
      try {
        setIntent(await api.get<Intent>(`/payments/intents/${intent.id}`));
      } catch {
        /* tenta de novo no próximo ciclo */
      }
    }, 3000);
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

  const simulate = (outcome: 'succeeded' | 'failed') =>
    a.run(async () => {
      await api.post(`/payments/intents/${intent!.id}/simulate`, { outcome });
      setIntent(await api.get<Intent>(`/payments/intents/${intent!.id}`));
    });

  const options = cfg
    ? ([
        ['mpesa', 'M-Pesa', cfg.payment_methods.mpesa],
        ['emola', 'e-Mola', cfg.payment_methods.emola],
        ['sandbox', 'Pagamento de teste (simulado)', cfg.payment_methods.sandbox],
      ] as const).filter(([, , on]) => on)
    : [];

  return (
    <Page title="Pagamento" back={kind === 'order' ? `/cliente/encomendas/${id}` : '/cliente/planos'}>
      <Loaded q={order}>
        {(o) => (
          <div className="stack">
            {o && (
              <Card>
                <p>Encomenda {o.code}</p>
                <div className="price">{mt(o.price_cents)}</div>
              </Card>
            )}
            {!intent && (
              <Card className="stack">
                {options.length === 0 && <Notice tone="warn">Nenhum método de pagamento está activo agora. M-Pesa e e-Mola ficam disponíveis após a integração oficial.</Notice>}
                {options.map(([k, l]) => (
                  <label key={k} className="radio">
                    <input type="radio" name="p" checked={provider === k} onChange={() => setProvider(k)} /> {l}
                  </label>
                ))}
                <Field label="Número da carteira móvel" hint="Vai receber o pedido de confirmação no telemóvel. Nunca escreva o PIN aqui.">
                  <input inputMode="tel" value={msisdn} onChange={(e) => setMsisdn(e.target.value)} />
                </Field>
                <ErrorBox error={a.error} />
                <Button busy={a.busy} disabled={!provider || msisdn.length < 9} onClick={start}>
                  Pagar
                </Button>
              </Card>
            )}
            {intent?.status === 'pending' && (
              <Card className="stack center">
                <div className="spinner" />
                <h3>A aguardar confirmação</h3>
                <p>Confirme o pagamento de {mt(intent.amount_cents)} no seu telemóvel.</p>
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
                    setIdem(newIdempotencyKey());
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
