import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CATEGORIES, dateTime, km, mt, PAY_METHOD, SERVICE } from '../shared/format';
import { MapView, type MapMarker } from '../shared/map';
import { useSession } from '../shared/session';
import { Button, Card, Confirm, ErrorBox, KV, Loaded, Notice, Page, StatusBadge, Timeline, useAction, useLoad } from '../shared/ui';

const ACTIVE = ['PENDENTE_ATRIBUICAO', 'ATRIBUIDO', 'ACEITE', 'RECOLHIDO', 'EM_TRANSPORTE', 'AGUARDA_PAGAMENTO'];

/** Acompanhar encomenda: estado, mapa, estafeta, código de entrega, cancelar, avaliar, comprovativo. */
export function Track() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const { api } = useSession();
  const nav = useNavigate();
  const q = useLoad(() => api.get(`/orders/${id}`), [id], 10_000);
  const [cancel, setCancel] = useState(false);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const rate = useAction();
  let code: string | null = null;
  try {
    code = sessionStorage.getItem(`levago.code.${id}`);
  } catch {
    code = null;
  }

  return (
    <Page title="Encomenda" back="/cliente/encomendas">
      <Loaded q={q}>
        {(o) => {
          const markers: MapMarker[] = [
            { lat: o.pickup.lat, lon: o.pickup.lon, kind: 'pickup' },
            { lat: o.dropoff.lat, lon: o.dropoff.lon, kind: 'dropoff' },
          ];
          if (o.courier_location) markers.push({ lat: o.courier_location.lat, lon: o.courier_location.lon, kind: 'courier', title: 'Estafeta' });
          return (
            <div className="stack">
              {search.get('novo') && <Notice tone="ok">Pedido registado com o código {o.code}.</Notice>}
              <Card>
                <div className="row-between">
                  <strong>{o.code}</strong>
                  <StatusBadge status={o.status} label={o.status_label} />
                </div>
                {o.status === 'AGUARDA_PAGAMENTO' && (
                  <Button onClick={() => nav(`/cliente/pagar/${o.id}`)}>Pagar agora</Button>
                )}
              </Card>
              {ACTIVE.includes(o.status) && o.status !== 'AGUARDA_PAGAMENTO' && (
                <Card className="code-card">
                  <small>Código de entrega</small>
                  <div className="code">{code ?? '••••'}</div>
                  <small>{code ? 'Mostre este código só ao estafeta, no momento da entrega.' : 'O código está na notificação "pedido criado".'}</small>
                </Card>
              )}
              <MapView markers={markers} route={o.route_geometry} />
              {o.courier && (
                <Card>
                  <KV
                    items={[
                      ['Estafeta', o.courier.name],
                      ['Veículo', o.courier.vehicle ?? '—'],
                      ['Avaliação', o.courier.rating_avg ? `${Number(o.courier.rating_avg).toFixed(1)} ★` : 'Novo'],
                      ...(o.courier_location ? ([['Posição actualizada', dateTime(o.courier_location.updated_at)]] as [string, string][]) : []),
                    ]}
                  />
                </Card>
              )}
              <Card>
                <h3>Linha temporal</h3>
                <Timeline events={o.events} />
              </Card>
              <Card>
                <KV
                  items={[
                    ['Recolha', o.pickup.text],
                    ['Entrega', o.dropoff.text],
                    ['Destinatário', `${o.recipient_name} (${o.recipient_phone})`],
                    ['Conteúdo', `${CATEGORIES[o.category] ?? o.category}: ${o.description}`],
                    ['Peso', `${o.weight_kg} kg`],
                    ['Distância', km(o.road_distance_m)],
                    ['Modalidade', SERVICE[o.service_type]],
                    ['Agendado para', o.scheduled_at ? dateTime(o.scheduled_at) : 'Assim que possível'],
                    ['Preço', mt(o.price_cents)],
                    ['Pagamento', `${PAY_METHOD[o.payment_method] ?? o.payment_method}`],
                    ['Criado em', dateTime(o.created_at)],
                    ...(o.cancel_reason ? ([['Motivo do cancelamento', o.cancel_reason]] as [string, string][]) : []),
                  ]}
                />
              </Card>
              {o.status === 'ENTREGUE' && !o.rating && (
                <Card className="stack">
                  <h3>Como correu a entrega?</h3>
                  <div className="stars" role="radiogroup" aria-label="Avaliação">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button key={n} aria-label={`${n} estrelas`} className={n <= stars ? 'on' : ''} onClick={() => setStars(n)}>
                        ★
                      </button>
                    ))}
                  </div>
                  <textarea rows={2} placeholder="Comentário (opcional)" value={comment} onChange={(e) => setComment(e.target.value)} />
                  <ErrorBox error={rate.error} />
                  <Button busy={rate.busy} disabled={!stars} onClick={async () => (await rate.run(() => api.post(`/orders/${o.id}/rating`, { stars, comment: comment || undefined }))) && q.reload()}>
                    Enviar avaliação
                  </Button>
                </Card>
              )}
              {o.rating && <Notice tone="ok">Avaliou esta entrega com {o.rating.stars} ★. Obrigado!</Notice>}
              <div className="row-between wrap">
                {['ENTREGUE', 'DEVOLVIDO', 'CANCELADO'].includes(o.status) && <Link to={`/cliente/encomendas/${o.id}/comprovativo`}>Ver comprovativo</Link>}
                <Link to={`/cliente/apoio?encomenda=${o.id}`}>Preciso de ajuda</Link>
                {o.can_cancel && (
                  <Button kind="danger" onClick={() => setCancel(true)}>
                    Cancelar pedido
                  </Button>
                )}
              </div>
              {cancel && (
                <Confirm
                  title="Cancelar pedido?"
                  text={o.payment_status === 'succeeded' ? 'O pagamento já foi feito. Vamos registar um pedido de reembolso.' : undefined}
                  reasonLabel="Motivo"
                  danger
                  confirmLabel="Cancelar pedido"
                  onClose={() => setCancel(false)}
                  onConfirm={async (reason) => {
                    await api.post(`/orders/${o.id}/cancel`, { reason });
                    await q.reload();
                    return true;
                  }}
                />
              )}
            </div>
          );
        }}
      </Loaded>
    </Page>
  );
}

export function Receipt() {
  const { id } = useParams();
  const { api } = useSession();
  const q = useLoad(() => api.get(`/orders/${id}/receipt`), [id]);
  return (
    <Page title="Comprovativo" back={`/cliente/encomendas/${id}`}>
      <Loaded q={q}>
        {(r) => (
          <Card className="receipt">
            <h2>{r.company}</h2>
            <KV
              items={[
                ['Código', r.code],
                ['Data', dateTime(r.created_at)],
                ['Estado', r.status],
                ['Modalidade', SERVICE[r.service_type]],
                ['Distância por estrada', `${r.road_distance_km.toLocaleString('pt-PT')} km`],
                ['Peso', `${r.weight_kg} kg`],
                ['Recolha', r.pickup],
                ['Entrega', r.dropoff],
                ['Método', PAY_METHOD[r.payment_method] ?? r.payment_method],
                ['Valor', `${r.price_mt.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} MT`],
              ]}
            />
            <Button kind="secondary" onClick={() => window.print()}>
              Imprimir ou guardar PDF
            </Button>
          </Card>
        )}
      </Loaded>
    </Page>
  );
}
