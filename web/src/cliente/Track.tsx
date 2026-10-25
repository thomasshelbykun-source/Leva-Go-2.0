import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '../shared/brand';
import { CATEGORIES, dateTime, HEADLINE, km, minutes, mt, PAY_METHOD, SERVICE, whatsappLink } from '../shared/format';
import { MapView, type MapMarker } from '../shared/map';
import { useSession } from '../shared/session';
import { Button, Card, Confirm, ErrorBox, KV, Loaded, Notice, OrderProgress, Page, Sheet, Timeline, useAction, useLoad } from '../shared/ui';

const ACTIVE = ['PENDENTE_ATRIBUICAO', 'ATRIBUIDO', 'ACEITE', 'RECOLHIDO', 'EM_TRANSPORTE', 'AGUARDA_PAGAMENTO'];
const LIVE = ['ACEITE', 'RECOLHIDO', 'EM_TRANSPORTE'];
const TAGS = ['Simpático', 'Rápido', 'Cuidadoso', 'Pontual'];

/** Seguimento da encomenda: mapa, estado, estafeta, código de entrega, partilha, avaliação e detalhes. */
export function Track() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const { api } = useSession();
  const nav = useNavigate();
  const q = useLoad(() => api.get(`/orders/${id}`), [id], 10_000);
  const [cancel, setCancel] = useState(false);
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const rate = useAction();
  let code: string | null = null;
  try {
    code = sessionStorage.getItem(`levago.code.${id}`);
  } catch {
    code = null;
  }

  const status = q.data?.status as string | undefined;
  const canShare = !!status && !['CANCELADO', 'AGUARDA_PAGAMENTO'].includes(status);
  // O link público é criado uma vez e depois reutilizado. Fica pronto antes do toque, para o WhatsApp abrir de imediato.
  useEffect(() => {
    if (!canShare || shareUrl) return;
    api
      .post<{ token: string }>(`/orders/${id}/share`)
      .then((r) => setShareUrl(`${location.origin}/seguir/${r.token}`))
      .catch(() => null);
  }, [canShare, shareUrl, api, id]);

  return (
    <Loaded q={q}>
      {(o) => {
        const markers: MapMarker[] = [
          { lat: o.pickup.lat, lon: o.pickup.lon, kind: 'pickup' },
          { lat: o.dropoff.lat, lon: o.dropoff.lon, kind: 'dropoff' },
        ];
        if (o.courier_location) markers.push({ lat: o.courier_location.lat, lon: o.courier_location.lon, kind: 'courier', title: 'Estafeta' });
        const live = LIVE.includes(o.status);
        return (
          <div className="map-screen">
            <MapView height="58vh" markers={markers} route={o.route_geometry} padBottom={140} />
            <div className="map-top">
              <Link to="/cliente/encomendas" className="round-btn" aria-label="Voltar">
                <Icon name="back" />
              </Link>
              <span className="badge badge-muted">{o.code}</span>
            </div>
            <Sheet>
              {search.get('novo') && <Notice tone="ok">Pedido registado com o código {o.code}.</Notice>}
              <div className="row-between">
                <div className="stack" style={{ gap: '0.2rem' }}>
                  <h2 className="headline">{HEADLINE[o.status] ?? o.status_label}</h2>
                  {o.status === 'PENDENTE_ATRIBUICAO' && <small className="sub">Vamos avisá-lo assim que alguém aceitar.</small>}
                  {o.cancel_reason && <small className="sub">Motivo: {o.cancel_reason}</small>}
                </div>
                {live && o.estimated_duration_s && (
                  <div className="eta">
                    <strong>{minutes(o.estimated_duration_s)}</strong>
                    <small>de viagem</small>
                  </div>
                )}
              </div>
              <OrderProgress status={o.status} />

              {o.status === 'AGUARDA_PAGAMENTO' && <Button onClick={() => nav(`/cliente/pagar/${o.id}`)}>Pagar agora</Button>}

              {o.courier && (
                <div className="driver">
                  <span className="avatar">{String(o.courier.name).slice(0, 1).toUpperCase()}</span>
                  <span className="txt">
                    <strong>{o.courier.name}</strong>
                    <small>
                      {o.courier.vehicle ? `${o.courier.vehicle === 'motorizada' ? 'Motorizada' : 'Bicicleta'} · ` : ''}
                      {o.courier.rating_avg ? `${Number(o.courier.rating_avg).toFixed(1)} ★` : 'Novo na LevaGo'}
                    </small>
                  </span>
                  <Link className="btn btn-secondary btn-sm" to={`/cliente/apoio?encomenda=${o.id}`}>
                    Ajuda
                  </Link>
                </div>
              )}

              {ACTIVE.includes(o.status) && o.status !== 'AGUARDA_PAGAMENTO' && (
                <div className="pin-box">
                  <div>
                    <small>Código de entrega</small>
                    <div className="code">{code ?? '••••'}</div>
                  </div>
                  <small style={{ maxWidth: '12rem' }}>{code ? 'Diga este código só ao estafeta, na entrega.' : 'O código está na notificação "pedido criado".'}</small>
                </div>
              )}

              {canShare && (
                <a
                  className={`btn btn-secondary nav-btn ${shareUrl ? '' : 'disabled'}`}
                  href={shareUrl ? whatsappLink(o.code, shareUrl) : undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-disabled={!shareUrl}
                >
                  <Icon name="share" size={18} /> Partilhar o seguimento por WhatsApp
                </a>
              )}

              {o.status === 'ENTREGUE' && !o.rating && (
                <Card className="stack">
                  <h3>Como correu a entrega?</h3>
                  <div className="stars" role="radiogroup" aria-label="Avaliação">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button key={n} role="radio" aria-checked={n === stars} aria-label={`${n} de 5`} className={n <= stars ? 'on' : ''} onClick={() => setStars(n)}>
                        ★
                      </button>
                    ))}
                  </div>
                  {stars > 0 && (
                    <>
                      <div className="chips">
                        {TAGS.map((t) => (
                          <button key={t} type="button" className={tags.includes(t) ? 'chip active' : 'chip'} onClick={() => setTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t])}>
                            {t}
                          </button>
                        ))}
                      </div>
                      <textarea rows={2} placeholder="Comentário (opcional)" value={comment} onChange={(e) => setComment(e.target.value)} />
                    </>
                  )}
                  <ErrorBox error={rate.error} />
                  <Button
                    busy={rate.busy}
                    disabled={!stars}
                    onClick={async () => {
                      const text = [tags.join(', '), comment.trim()].filter(Boolean).join('. ');
                      if (await rate.run(() => api.post(`/orders/${o.id}/rating`, { stars, comment: text || undefined }))) await q.reload();
                    }}
                  >
                    Enviar avaliação
                  </Button>
                </Card>
              )}
              {o.rating && <Notice tone="ok">Avaliou esta entrega com {o.rating.stars} ★. Obrigado.</Notice>}

              <details className="more">
                <summary>
                  Detalhes da encomenda <Icon name="chevron" size={18} />
                </summary>
                <div className="stack" style={{ paddingTop: '0.6rem' }}>
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
                    ]}
                  />
                  <h3>Linha temporal</h3>
                  <Timeline events={o.events} />
                </div>
              </details>

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
            </Sheet>
          </div>
        );
      }}
    </Loaded>
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
