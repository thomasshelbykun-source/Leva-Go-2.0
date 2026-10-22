import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CATEGORIES, dateTime, km, lbl, mt, SERVICE } from '../shared/format';
import { MapView, type MapMarker } from '../shared/map';
import { useSession } from '../shared/session';
import {
  Badge, Button, ButtonLink, Card, Confirm, Empty, ErrorBox, Field, KV, Loaded, Notice, Page, StatusBadge, Tabs, Timeline, useAction, useLoad,
} from '../shared/ui';

const DOCS: Record<string, string> = { bi: 'Bilhete de identidade', carta_conducao: 'Carta de condução', livrete: 'Livrete', seguro: 'Seguro', foto: 'Fotografia', outro: 'Outro' };
const STATE: Record<string, [string, string]> = {
  pending: ['Em análise', 'warn'], approved: ['Aprovado', 'ok'], rejected: ['Rejeitado', 'bad'], active: ['Activo', 'ok'], suspended: ['Suspenso', 'bad'],
};
const st = (s: string) => <Badge tone={STATE[s]?.[1]}>{STATE[s]?.[0] ?? s}</Badge>;

export function CourierWelcome() {
  return (
    <div className="welcome">
      <img src="/icon.svg" alt="" width={88} height={88} />
      <h1>LevaGo Estafeta</h1>
      <p className="slogan">Faça entregas em Quelimane, de bicicleta ou motorizada.</p>
      <ul className="bullets">
        <li>Registe-se e envie os documentos.</li>
        <li>A equipa LevaGo verifica e aprova a sua conta.</li>
        <li>Fique online no horário de serviço e aceite pedidos.</li>
      </ul>
      <ButtonLink to="/estafeta/registo">Candidatar-me</ButtonLink>
      <ButtonLink to="/estafeta/entrar" kind="secondary">
        Já tenho conta
      </ButtonLink>
    </div>
  );
}

// ------------------------------------------------------------------ Candidatura e documentos
export function Apply() {
  const { api } = useSession();
  const nav = useNavigate();
  const me = useLoad(() => api.get('/courier/me'), []);
  const [f, setF] = useState({ link_type: 'independente', vehicle_kind: 'bicicleta', plate: '', ownership: 'particular', capacity_kg: '10', consent: false });
  const a = useAction();
  return (
    <Page title="Candidatura" back="/estafeta">
      <Loaded q={me}>
        {(m) =>
          m.application && m.application.status !== 'rejected' ? (
            <Documents me={m} reload={me.reload} />
          ) : (
            <Card className="stack">
              {m.application?.status === 'rejected' && <Notice tone="bad">A candidatura anterior não foi aprovada: {m.application.review_note}</Notice>}
              <Field label="Vínculo">
                <select value={f.link_type} onChange={(e) => setF({ ...f, link_type: e.target.value })}>
                  <option value="independente">Estafeta independente</option>
                  <option value="proprio">Estafeta próprio da LevaGo</option>
                </select>
              </Field>
              <Field label="Veículo">
                <select value={f.vehicle_kind} onChange={(e) => setF({ ...f, vehicle_kind: e.target.value })}>
                  <option value="bicicleta">Bicicleta</option>
                  <option value="motorizada">Motorizada</option>
                </select>
              </Field>
              {f.vehicle_kind === 'motorizada' && (
                <Field label="Matrícula">
                  <input value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value.toUpperCase() })} />
                </Field>
              )}
              <Field label="O veículo é">
                <select value={f.ownership} onChange={(e) => setF({ ...f, ownership: e.target.value })}>
                  <option value="particular">Meu (particular)</option>
                  <option value="empresa">Da LevaGo</option>
                </select>
              </Field>
              <Field label="Capacidade de carga (kg, até 15)" hint="A equipa confirma a capacidade na aprovação.">
                <input inputMode="decimal" value={f.capacity_kg} onChange={(e) => setF({ ...f, capacity_kg: e.target.value })} />
              </Field>
              <label className="check">
                <input type="checkbox" checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} /> Autorizo a verificação dos meus documentos.
              </label>
              <ErrorBox error={a.error} />
              <Button
                busy={a.busy}
                disabled={!f.consent}
                onClick={async () => {
                  const r = await a.run(() => api.post('/courier/apply', { ...f, plate: f.plate || undefined, capacity_kg: Number(f.capacity_kg.replace(',', '.')) }));
                  if (r) {
                    await me.reload();
                    nav('/estafeta/candidatura');
                  }
                }}
              >
                Enviar candidatura
              </Button>
            </Card>
          )
        }
      </Loaded>
    </Page>
  );
}

function Documents({ me, reload }: { me: any; reload: () => void }) {
  const { api } = useSession();
  const [kind, setKind] = useState('bi');
  const [file, setFile] = useState<File | null>(null);
  const a = useAction();
  const needed = me.vehicle?.kind === 'motorizada' || me.vehicles?.some((v: any) => v.kind === 'motorizada') ? ['bi', 'carta_conducao', 'livrete', 'foto'] : ['bi', 'foto'];
  return (
    <div className="stack">
      <Card>
        <div className="row-between">
          <strong>Estado da candidatura</strong>
          {st(me.application.status)}
        </div>
        {me.application.status === 'pending' && <p className="small">A equipa LevaGo vai rever a candidatura e os documentos. Recebe uma notificação com a decisão.</p>}
        {me.application.status === 'approved' && <Link to="/estafeta">Ir para o início</Link>}
      </Card>
      <Card className="stack">
        <h3>Documentos</h3>
        <p className="small">Necessários: {needed.map((k) => DOCS[k]).join(', ')}.</p>
        <ul className="list">
          {me.documents.map((d: any) => (
            <li key={d.id} className="row-between">
              <span>{DOCS[d.kind] ?? d.kind}</span>
              {st(d.status)}
            </li>
          ))}
        </ul>
        <Field label="Tipo de documento">
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {Object.entries(DOCS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Ficheiro (JPG, PNG, WEBP ou PDF até 5 MB)">
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
        <ErrorBox error={a.error} />
        <Button
          busy={a.busy}
          disabled={!file}
          onClick={async () => {
            const form = new FormData();
            form.set('file', file!);
            form.set('kind', kind);
            if (['livrete', 'seguro'].includes(kind) && me.vehicles?.[0]) form.set('vehicle_id', me.vehicles[0].id);
            if (await a.run(() => api.upload('/courier/documents', form))) {
              setFile(null);
              reload();
            }
          }}
        >
          Enviar documento
        </Button>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ Início (disponibilidade e pedidos)
export function CourierHome() {
  const { api } = useSession();
  const nav = useNavigate();
  const me = useLoad(() => api.get('/courier/me'), [], 30_000);
  const active = useLoad(() => (me.data?.profile?.status === 'active' ? api.get<any[]>('/courier/orders/active') : Promise.resolve([])), [me.data?.profile?.status], 15_000);
  const avail = useLoad(() => (me.data?.profile?.is_online ? api.get('/courier/orders/available') : Promise.resolve({ online: false, items: [] })), [me.data?.profile?.is_online], 15_000);
  const toggle = useAction();

  if (me.loading && !me.data) return <Page title="Início"><Loaded q={me}>{() => null}</Loaded></Page>;
  const m = me.data;
  if (!m) return <Page title="Início"><ErrorBox error={me.error} retry={me.reload} /></Page>;
  if (!m.application || m.application.status !== 'approved' || m.profile?.status !== 'active') {
    return (
      <Page title="Início">
        <Card className="stack">
          <h2>Olá, {String(m.name).split(' ')[0]}!</h2>
          {!m.application && <p>Para fazer entregas, complete a candidatura e envie os documentos.</p>}
          {m.application?.status === 'pending' && <p>A sua candidatura está em análise.</p>}
          {m.application?.status === 'rejected' && <Notice tone="bad">Candidatura não aprovada: {m.application.review_note}</Notice>}
          {m.profile?.status === 'suspended' && <Notice tone="bad">A sua conta de estafeta está suspensa. Contacte o apoio.</Notice>}
          <ButtonLink to="/estafeta/candidatura">{m.application ? 'Ver candidatura e documentos' : 'Começar candidatura'}</ButtonLink>
        </Card>
      </Page>
    );
  }
  const online = !!m.profile.is_online;
  return (
    <Page title="Início">
      <div className="stack">
        <Card className={online ? 'online-card on' : 'online-card'}>
          <div className="row-between">
            <div>
              <strong>{online ? 'Está online' : 'Está offline'}</strong>
              <small>{m.vehicle ? `${lbl(m.vehicle.kind)} · até ${m.vehicle.capacity_kg} kg` : 'Sem veículo aprovado'}</small>
            </div>
            <Button
              kind={online ? 'secondary' : 'primary'}
              busy={toggle.busy}
              onClick={async () => (await toggle.run(() => api.post('/courier/availability', { online: !online }))) && me.reload(true)}
            >
              {online ? 'Ficar offline' : 'Ficar online'}
            </Button>
          </div>
          {!m.open_now && <small>{m.hours_message}</small>}
          <ErrorBox error={toggle.error} />
        </Card>
        <div className="grid-2">
          <Card>
            <small>Ganhos de hoje</small>
            <div className="price">{mt(m.today.earned_cents)}</div>
          </Card>
          <Card>
            <small>Entregas hoje</small>
            <div className="price">{m.today.deliveries}</div>
          </Card>
        </div>
        {(active.data ?? []).length > 0 && (
          <div className="stack">
            <h3>Em curso</h3>
            {active.data!.map((o) => (
              <Card key={o.id} onClick={() => nav(`/estafeta/tarefa/${o.id}`)}>
                <div className="row-between">
                  <strong>{o.code}</strong>
                  <StatusBadge status={o.status} label={o.status_label} />
                </div>
                <small className="ellipsis">{o.pickup?.text}</small>
              </Card>
            ))}
          </div>
        )}
        <h3>Pedidos disponíveis</h3>
        {!online ? (
          <Empty title="Fique online para ver pedidos" />
        ) : (
          <Loaded q={avail}>
            {(d) =>
              d.items.length === 0 ? (
                <Empty title="Sem pedidos agora" text="A lista actualiza sozinha." />
              ) : (
                <div className="stack">
                  {d.items.map((o: any) => (
                    <Card key={o.id} onClick={() => nav(`/estafeta/tarefa/${o.id}`)} className={o.offered_to_me ? 'selected' : ''}>
                      <div className="row-between">
                        <strong>
                          {o.code} {o.service_type === 'expressa' && <Badge tone="warn">Expressa</Badge>} {o.offered_to_me && <Badge tone="info">Atribuído a si</Badge>}
                        </strong>
                        <strong>{mt(o.earning_cents)}</strong>
                      </div>
                      <small className="ellipsis">Recolha: {o.pickup.text}</small>
                      <small>
                        Destino aproximado: {o.dropoff_area.area} · {km(o.road_distance_m)} · {o.weight_kg} kg
                      </small>
                    </Card>
                  ))}
                </div>
              )
            }
          </Loaded>
        )}
      </div>
    </Page>
  );
}

// ------------------------------------------------------------------ Tarefa: detalhe, aceitar, recolha, entrega, incidente
/** Partilha a posição só durante a entrega activa (a API recusa fora disso). */
function useShareLocation(active: boolean) {
  const { api } = useSession();
  const last = useRef(0);
  useEffect(() => {
    if (!active || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        if (Date.now() - last.current < 20_000) return;
        last.current = Date.now();
        void api.post('/courier/location', { lat: p.coords.latitude, lon: p.coords.longitude, accuracy_m: p.coords.accuracy }).catch(() => null);
      },
      () => null,
      { enableHighAccuracy: true, maximumAge: 10_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [active, api]);
}

const PICKUP_CHECK = ['Encomenda corresponde à descrição', 'Embalagem fechada e em bom estado', 'Peso compatível com o veículo'];
const DELIVERY_CHECK = ['Entreguei à pessoa indicada', 'Encomenda em bom estado'];

export function Task() {
  const { id } = useParams();
  const { api } = useSession();
  const nav = useNavigate();
  const q = useLoad(() => api.get(`/courier/orders/${id}`), [id], 15_000);
  const a = useAction();
  const [check, setCheck] = useState<string[]>([]);
  const [photo, setPhoto] = useState<File | null>(null);
  const [code, setCode] = useState('');
  const [cash, setCash] = useState(false);
  const [dialog, setDialog] = useState<'decline' | 'incident' | null>(null);
  const [incident, setIncident] = useState({ kind: 'destinatario_ausente', fail: false });
  useShareLocation(!!q.data?.mine && ['ACEITE', 'RECOLHIDO', 'EM_TRANSPORTE'].includes(q.data?.status));

  const here = () =>
    new Promise<{ lat?: number; lon?: number }>((res) => {
      if (!navigator.geolocation) return res({});
      navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lon: p.coords.longitude }), () => res({}), { timeout: 5000 });
    });
  const uploadPhoto = async () => {
    if (!photo) return undefined;
    const form = new FormData();
    form.set('file', photo);
    return (await api.upload<{ photo_key: string }>('/courier/proofs/upload', form)).photo_key;
  };
  const step = async (fn: () => Promise<unknown>) => {
    if (await a.run(fn)) {
      setCheck([]);
      setPhoto(null);
      setCode('');
      await q.reload(true);
    }
  };

  return (
    <Page title="Tarefa" back="/estafeta">
      <Loaded q={q}>
        {(o) => {
          const markers: MapMarker[] = [{ lat: o.pickup.lat, lon: o.pickup.lon, kind: 'pickup' }];
          markers.push({ lat: o.dropoff.lat, lon: o.dropoff.lon, kind: o.recipient ? 'dropoff' : 'area' });
          const checklist = (items: string[]) => (
            <div className="stack">
              {items.map((c) => (
                <label key={c} className="check">
                  <input type="checkbox" checked={check.includes(c)} onChange={(e) => setCheck(e.target.checked ? [...check, c] : check.filter((x) => x !== c))} /> {c}
                </label>
              ))}
              <Field label="Foto (opcional)">
                <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
              </Field>
            </div>
          );
          return (
            <div className="stack">
              <Card>
                <div className="row-between">
                  <strong>
                    {o.code} {o.service_type === 'expressa' && <Badge tone="warn">Expressa</Badge>}
                  </strong>
                  <StatusBadge status={o.status} label={o.status_label} />
                </div>
              </Card>
              <MapView markers={markers} />
              <Card>
                <KV
                  items={[
                    ['Recolha', o.pickup.text],
                    ...(o.pickup.contact ? ([['Contacto na recolha', <a href={`tel:${o.pickup.contact}`}>{o.pickup.contact}</a>]] as [string, React.ReactNode][]) : []),
                    ['Entrega', o.recipient ? o.dropoff.text : `Zona aproximada: ${o.dropoff.area} (morada exacta após aceitar)`],
                    ...(o.recipient ? ([['Destinatário', <span>{o.recipient.name} · <a href={`tel:${o.recipient.phone}`}>{o.recipient.phone}</a></span>]] as [string, React.ReactNode][]) : []),
                    ['Conteúdo', `${CATEGORIES[o.category] ?? o.category}: ${o.description}`],
                    ['Peso', `${o.weight_kg} kg`],
                    ['Distância', km(o.road_distance_m)],
                    ['Modalidade', SERVICE[o.service_type]],
                    ...(o.scheduled_at ? ([['Agendado', dateTime(o.scheduled_at)]] as [string, string][]) : []),
                    ...(o.notes ? ([['Observações', o.notes]] as [string, string][]) : []),
                    ...(o.payment.collect_cents ? ([['Cobrar na entrega', mt(o.payment.collect_cents)]] as [string, string][]) : []),
                  ]}
                />
              </Card>

              {(o.status === 'PENDENTE_ATRIBUICAO' || (o.status === 'ATRIBUIDO' && o.mine)) && (
                <div className="row-between">
                  {o.status === 'ATRIBUIDO' && (
                    <Button kind="ghost" onClick={() => setDialog('decline')}>
                      Recusar
                    </Button>
                  )}
                  <Button busy={a.busy} onClick={() => step(() => api.post(`/courier/orders/${o.id}/accept`))}>
                    Aceitar pedido
                  </Button>
                </div>
              )}

              {o.mine && o.status === 'ACEITE' && (
                <Card className="stack">
                  <h3>Confirmar recolha</h3>
                  {checklist(PICKUP_CHECK)}
                  <Button
                    busy={a.busy}
                    disabled={check.length < PICKUP_CHECK.length}
                    onClick={() => step(async () => api.post(`/courier/orders/${o.id}/pickup`, { checklist: check, photo_key: await uploadPhoto(), ...(await here()) }))}
                  >
                    Encomenda recolhida
                  </Button>
                </Card>
              )}

              {o.mine && o.status === 'RECOLHIDO' && (
                <Button busy={a.busy} onClick={() => step(() => api.post(`/courier/orders/${o.id}/start`))}>
                  Iniciar transporte
                </Button>
              )}

              {o.mine && o.status === 'EM_TRANSPORTE' && (
                <Card className="stack">
                  <h3>Finalizar entrega</h3>
                  <Field label="Código de entrega (4 dígitos, dado pelo cliente)">
                    <input inputMode="numeric" maxLength={4} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
                  </Field>
                  {checklist(DELIVERY_CHECK)}
                  {o.payment.collect_cents > 0 && (
                    <label className="check">
                      <input type="checkbox" checked={cash} onChange={(e) => setCash(e.target.checked)} /> Recebi {mt(o.payment.collect_cents)} do cliente
                    </label>
                  )}
                  <Button
                    busy={a.busy}
                    disabled={code.length !== 4 || (o.payment.collect_cents > 0 && !cash)}
                    onClick={() => step(async () => api.post(`/courier/orders/${o.id}/deliver`, { code, checklist: check, cash_collected: cash, photo_key: await uploadPhoto(), ...(await here()) }))}
                  >
                    Confirmar entrega
                  </Button>
                </Card>
              )}

              {o.mine && ['FALHA_ENTREGA', 'DEVOLUCAO_PENDENTE'].includes(o.status) && (
                <Card className="stack">
                  <Notice tone="warn">Leve a encomenda de volta ao ponto de recolha e confirme a devolução.</Notice>
                  <Button busy={a.busy} onClick={() => step(() => api.post(`/courier/orders/${o.id}/returned`))}>
                    Confirmar devolução
                  </Button>
                </Card>
              )}

              {o.status === 'ENTREGUE' && <Notice tone="ok">Entrega concluída. Obrigado!</Notice>}
              <ErrorBox error={a.error} />

              {o.mine && ['ACEITE', 'RECOLHIDO', 'EM_TRANSPORTE'].includes(o.status) && (
                <Button kind="ghost" onClick={() => setDialog('incident')}>
                  Reportar problema
                </Button>
              )}
              {o.mine && o.events.length > 0 && (
                <Card>
                  <h3>Histórico</h3>
                  <Timeline events={o.events} />
                </Card>
              )}

              {dialog === 'decline' && (
                <Confirm
                  title="Recusar pedido?"
                  reasonLabel="Motivo"
                  confirmLabel="Recusar"
                  danger
                  onClose={() => setDialog(null)}
                  onConfirm={async (reason) => {
                    await api.post(`/courier/orders/${o.id}/decline`, { reason });
                    nav('/estafeta');
                    return true;
                  }}
                />
              )}
              {dialog === 'incident' && (
                <Confirm
                  title="Reportar problema"
                  reasonLabel="Descreva o que aconteceu"
                  confirmLabel="Enviar"
                  onClose={() => setDialog(null)}
                  onConfirm={async (description) => {
                    await api.post(`/courier/orders/${o.id}/incident`, { kind: incident.kind, description, fail_delivery: incident.fail });
                    await q.reload(true);
                    return true;
                  }}
                >
                  <Field label="Tipo">
                    <select value={incident.kind} onChange={(e) => setIncident({ ...incident, kind: e.target.value })}>
                      <option value="destinatario_ausente">Destinatário ausente</option>
                      <option value="morada_errada">Morada errada</option>
                      <option value="volume_danificado">Volume danificado</option>
                      <option value="acidente">Acidente</option>
                      <option value="seguranca">Segurança</option>
                      <option value="outro">Outro</option>
                    </select>
                  </Field>
                  {['RECOLHIDO', 'EM_TRANSPORTE'].includes(o.status) && (
                    <label className="check">
                      <input type="checkbox" checked={incident.fail} onChange={(e) => setIncident({ ...incident, fail: e.target.checked })} /> Não é possível entregar (marcar falha)
                    </label>
                  )}
                </Confirm>
              )}
            </div>
          );
        }}
      </Loaded>
    </Page>
  );
}

// ------------------------------------------------------------------ Histórico
export function History() {
  const { api } = useSession();
  const nav = useNavigate();
  const q = useLoad(() => api.get<any[]>('/courier/orders/history'), []);
  return (
    <Page title="Histórico">
      <Loaded q={q}>
        {(items) =>
          items.length === 0 ? (
            <Empty title="Ainda sem entregas" />
          ) : (
            <div className="stack">
              {items.map((o) => (
                <Card key={o.id} onClick={() => nav(`/estafeta/tarefa/${o.id}`)}>
                  <div className="row-between">
                    <strong>{o.code}</strong>
                    <StatusBadge status={o.status} />
                  </div>
                  <div className="row-between small">
                    <span>{dateTime(o.updated_at)}</span>
                    <span>{o.amount_cents != null ? mt(o.amount_cents) : '—'}</span>
                  </div>
                </Card>
              ))}
            </div>
          )
        }
      </Loaded>
    </Page>
  );
}

// ------------------------------------------------------------------ Ganhos
export function Earnings() {
  const { api } = useSession();
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('week');
  const q = useLoad(() => api.get(`/courier/earnings?period=${period}`), [period]);
  const [dispute, setDispute] = useState<string | null>(null);
  return (
    <Page title="Ganhos">
      <Tabs value={period} onChange={setPeriod} options={[['day', 'Hoje'], ['week', '7 dias'], ['month', '30 dias']]} />
      <Loaded q={q}>
        {(d) => (
          <div className="stack">
            <div className="grid-2">
              <Card>
                <small>Total</small>
                <div className="price">{mt(d.total)}</div>
              </Card>
              <Card>
                <small>Por liquidar</small>
                <div className="price">{mt(d.pending)}</div>
              </Card>
            </div>
            <p className="small">{d.deliveries ?? 0} entrega(s) no período.</p>
            {d.entries.length === 0 ? (
              <Empty title="Sem movimentos neste período" />
            ) : (
              <ul className="list">
                {d.entries.map((e: any) => (
                  <li key={e.id} className="row-between">
                    <span>
                      <strong>{e.code ?? (e.kind === 'ajuste' ? 'Ajuste' : e.kind)}</strong>
                      <small> {dateTime(e.created_at)} {e.payout_id ? '· liquidado' : ''}</small>
                    </span>
                    <span>
                      {mt(e.amount_cents)}{' '}
                      <button className="link" onClick={() => setDispute(e.id)}>
                        Contestar
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {d.payouts.length > 0 && (
              <Card>
                <h3>Liquidações</h3>
                <ul className="list">
                  {d.payouts.map((p: any) => (
                    <li key={p.id} className="row-between">
                      <span>{dateTime(p.paid_at ?? p.created_at)} · Ref. {p.reference}</span>
                      <strong>{mt(p.amount_cents)}</strong>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            {dispute && (
              <Confirm
                title="Contestar valor"
                reasonLabel="Explique o problema"
                confirmLabel="Enviar contestação"
                onClose={() => setDispute(null)}
                onConfirm={async (message) => {
                  await api.post(`/courier/earnings/${dispute}/dispute`, { message });
                  return true;
                }}
              />
            )}
          </div>
        )}
      </Loaded>
    </Page>
  );
}

// ------------------------------------------------------------------ Veículo
export function Vehicle() {
  const { api } = useSession();
  const q = useLoad(() => api.get('/courier/me'), []);
  const [edit, setEdit] = useState<{ id: string; plate: string; capacity_kg: string } | null>(null);
  const a = useAction();
  return (
    <Page title="Veículo" back="/estafeta/perfil">
      <Loaded q={q}>
        {(m) => (
          <div className="stack">
            {m.vehicles.length === 0 && <Empty title="Sem veículo" action={<ButtonLink to="/estafeta/candidatura">Fazer candidatura</ButtonLink>} />}
            {m.vehicles.map((v: any) => (
              <Card key={v.id} className="stack">
                <div className="row-between">
                  <strong>
                    {v.kind === 'motorizada' ? 'Motorizada' : 'Bicicleta'} {v.plate ?? ''}
                  </strong>
                  {st(v.status)}
                </div>
                <KV items={[['Capacidade', `${v.capacity_kg} kg`], ['Propriedade', v.ownership === 'empresa' ? 'LevaGo' : 'Particular'], ...(v.review_note ? ([['Nota da revisão', v.review_note]] as [string, string][]) : [])]} />
                {edit?.id === v.id ? (
                  <>
                    <Notice tone="warn">Alterar o veículo volta a pô-lo em revisão. Não recebe pedidos até nova aprovação.</Notice>
                    {v.kind === 'motorizada' && (
                      <Field label="Matrícula">
                        <input value={edit!.plate} onChange={(e) => setEdit({ ...edit!, plate: e.target.value.toUpperCase() })} />
                      </Field>
                    )}
                    <Field label="Capacidade (kg)">
                      <input inputMode="decimal" value={edit!.capacity_kg} onChange={(e) => setEdit({ ...edit!, capacity_kg: e.target.value })} />
                    </Field>
                    <ErrorBox error={a.error} />
                    <Button
                      busy={a.busy}
                      onClick={async () => {
                        if (await a.run(() => api.patch(`/courier/vehicles/${v.id}`, { plate: edit!.plate || undefined, capacity_kg: Number(edit!.capacity_kg.replace(',', '.')) }))) {
                          setEdit(null);
                          q.reload();
                        }
                      }}
                    >
                      Enviar para revisão
                    </Button>
                  </>
                ) : (
                  <Button kind="secondary" onClick={() => setEdit({ id: v.id, plate: v.plate ?? '', capacity_kg: String(v.capacity_kg) })}>
                    Alterar dados
                  </Button>
                )}
              </Card>
            ))}
          </div>
        )}
      </Loaded>
    </Page>
  );
}
