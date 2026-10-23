import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CATEGORIES, dateTime, lbl, km, mt, PAY_METHOD, SERVICE, STATUS_LABEL, todayMaputo } from '../shared/format';
import { MapView } from '../shared/map';
import { useSession } from '../shared/session';
import { Badge, Button, Card, Confirm, ErrorBox, Field, KV, Loaded, Notice, Page, StatusBadge, Timeline, useLoad } from '../shared/ui';
import { Bars, download, Stat, Table } from './common';

// ------------------------------------------------------------------ 02 Painel
export function Dashboard() {
  const { api } = useSession();
  const [from, setFrom] = useState(todayMaputo(-6));
  const [to, setTo] = useState(todayMaputo());
  const q = useLoad(() => api.get(`/admin/dashboard?from=${from}&to=${to}`), [from, to], 60_000);
  return (
    <Page title="Dashboard" wide actions={<DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />}>
      <Loaded q={q}>
        {(d) => (
          <div className="stack">
            {d.alerts.length > 0 && (
              <div className="stack">
                {d.alerts.map((a: any, i: number) => (
                  <Notice key={i} tone={a.level === 'critical' ? 'bad' : a.level === 'warning' ? 'warn' : 'info'}>
                    <Link to={a.link}>{a.text}</Link>
                  </Notice>
                ))}
              </div>
            )}
            <div className="stats">
              <Stat label="Pedidos" value={d.orders?.total ?? 0} />
              <Stat label="Entregues" value={d.orders?.delivered ?? 0} tone="ok" />
              <Stat label="Cancelados" value={d.orders?.cancelled ?? 0} />
              <Stat label="Receita confirmada" value={mt(d.revenue?.paid)} tone="ok" />
              <Stat label="Reembolsado" value={mt(d.revenue?.refunded)} />
              <Stat label="Estafetas activos" value={d.couriers?.active ?? 0} />
              <Stat label="Online agora" value={d.couriers?.online ?? 0} tone="ok" />
              <Stat label="Candidaturas pendentes" value={d.couriers?.pending ?? 0} tone={d.couriers?.pending ? 'warn' : undefined} />
            </div>
            <Card>
              <h3>Pedidos por dia</h3>
              {d.series.length ? <Bars data={d.series} label="day" value="orders" /> : <p className="muted">Sem pedidos no período.</p>}
            </Card>
            <Card>
              <h3>Por estado</h3>
              <div className="chips">
                {d.by_status.map((s: any) => (
                  <Link key={s.status} className="chip" to={`/admin/encomendas?status=${s.status}`}>
                    {STATUS_LABEL[s.status] ?? s.status}: {s.n}
                  </Link>
                ))}
              </div>
            </Card>
          </div>
        )}
      </Loaded>
    </Page>
  );
}

export function DateRange({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (s: string) => void; setTo: (s: string) => void }) {
  return (
    <div className="row-end">
      <input type="date" aria-label="De" value={from} onChange={(e) => setFrom(e.target.value)} />
      <input type="date" aria-label="Até" value={to} onChange={(e) => setTo(e.target.value)} />
    </div>
  );
}

// ------------------------------------------------------------------ 03 Clientes
export function Customers() {
  const { api } = useSession();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const list = useLoad(() => api.get<any[]>(`/admin/customers?q=${encodeURIComponent(q)}${status ? `&status=${status}` : ''}`), [q, status]);
  return (
    <Page title="Clientes" wide>
      <div className="filters">
        <input placeholder="Nome ou telemóvel" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos</option>
          <option value="active">Activos</option>
          <option value="suspended">Suspensos</option>
        </select>
      </div>
      <Loaded q={list}>
        {(rows) => (
          <Table
            head={['Nome', 'Telemóvel', 'Estado', 'Encomendas', 'Registo', '']}
            rows={rows.map((c) => [c.name, c.phone, <Badge tone={c.status === 'active' ? 'ok' : 'bad'}>{c.status === 'active' ? 'Activo' : c.status === 'suspended' ? 'Suspenso' : c.status}</Badge>, c.orders, dateTime(c.created_at), <button className="link" onClick={() => nav(`/admin/clientes/${c.id}`)}>Abrir</button>])}
          />
        )}
      </Loaded>
    </Page>
  );
}

export function CustomerDetail() {
  const { id } = useParams();
  const { api } = useSession();
  const q = useLoad(() => api.get(`/admin/customers/${id}`), [id]);
  const [dlg, setDlg] = useState(false);
  return (
    <Page title="Cliente" back="/admin/clientes" wide>
      <Loaded q={q}>
        {(c) => (
          <div className="stack">
            <Notice>O acesso a estes dados fica registado na auditoria.</Notice>
            <Card>
              <KV items={[['Nome', c.name], ['Telemóvel', c.phone], ['Email', c.email ?? '—'], ['Estado', c.status], ['Papéis', c.roles.join(', ')], ['Registo', dateTime(c.created_at)]]} />
              <Button kind={c.status === 'active' ? 'danger' : 'primary'} onClick={() => setDlg(true)}>
                {c.status === 'active' ? 'Suspender conta' : 'Reactivar conta'}
              </Button>
            </Card>
            <Card>
              <h3>Encomendas</h3>
              <Table head={['Código', 'Estado', 'Valor', 'Data']} rows={c.orders.map((o: any) => [<Link to={`/admin/encomendas/${o.id}`}>{o.code}</Link>, <StatusBadge status={o.status} />, mt(o.price_cents), dateTime(o.created_at)])} />
            </Card>
            <Card>
              <h3>Apoio</h3>
              <Table head={['Assunto', 'Estado', 'Data']} rows={c.tickets.map((t: any) => [<Link to={`/admin/suporte/${t.id}`}>{t.subject}</Link>, lbl(t.status), dateTime(t.created_at)])} />
            </Card>
            <Card>
              <h3>Acções administrativas</h3>
              <Table head={['Acção', 'Motivo', 'Data']} rows={c.actions.map((a: any) => [a.action, a.reason, dateTime(a.created_at)])} />
            </Card>
            {dlg && (
              <Confirm
                title={c.status === 'active' ? 'Suspender conta?' : 'Reactivar conta?'}
                text={c.status === 'active' ? 'A pessoa deixa de conseguir entrar e as sessões abertas terminam.' : undefined}
                reasonLabel="Motivo (fica na auditoria)"
                danger={c.status === 'active'}
                onClose={() => setDlg(false)}
                onConfirm={async (reason) => {
                  await api.post(`/admin/customers/${id}/status`, { status: c.status === 'active' ? 'suspended' : 'active', reason });
                  await q.reload();
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

// ------------------------------------------------------------------ 04 Estafetas
export function Couriers() {
  const { api } = useSession();
  const q = useLoad(() => api.get('/admin/couriers'), []);
  return (
    <Page title="Estafetas" wide>
      <Loaded q={q}>
        {(d) => (
          <div className="stack">
            <Card>
              <h3>Candidaturas</h3>
              <Table
                head={['Nome', 'Telemóvel', 'Vínculo', 'Estado', 'Data', '']}
                rows={d.applications.map((a: any) => [a.name, a.phone, lbl(a.link_type), <Badge tone={a.status === 'pending' ? 'warn' : a.status === 'approved' ? 'ok' : 'bad'}>{lbl(a.status)}</Badge>, dateTime(a.created_at), <Link to={`/admin/estafetas/${a.user_id}`}>Rever</Link>])}
              />
            </Card>
            <Card>
              <h3>Frota</h3>
              <Table
                head={['Nome', 'Vínculo', 'Estado', 'Online', 'Veículo', 'Entregas', 'Avaliação', '']}
                rows={d.couriers.map((c: any) => [
                  c.name, lbl(c.link_type), lbl(c.status), c.is_online ? <Badge tone="ok">Online</Badge> : '—', c.vehicle ?? 'Sem veículo aprovado', c.delivered,
                  c.rating_avg ? `${Number(c.rating_avg).toFixed(1)} (${c.rating_count})` : '—', <Link to={`/admin/estafetas/${c.user_id}`}>Abrir</Link>,
                ])}
              />
            </Card>
          </div>
        )}
      </Loaded>
    </Page>
  );
}

type Dlg = { title: string; path: string; body: Record<string, unknown>; danger?: boolean; extra?: 'capacity' | 'adjust' } | null;

export function CourierDetail() {
  const { id } = useParams();
  const { api } = useSession();
  const q = useLoad(() => api.get(`/admin/couriers/${id}`), [id]);
  const zones = useLoad(() => api.get<any[]>('/admin/zones'), []);
  const [dlg, setDlg] = useState<Dlg>(null);
  const [num, setNum] = useState('');
  const [zone, setZone] = useState('');
  return (
    <Page title="Estafeta" back="/admin/estafetas" wide>
      <Loaded q={q}>
        {(d) => {
          const pendingApp = d.applications.find((a: any) => a.status === 'pending');
          return (
            <div className="stack">
              <Notice>O acesso a estes dados e aos documentos fica registado na auditoria.</Notice>
              <Card>
                <KV
                  items={[
                    ['Nome', d.user.name], ['Telemóvel', d.user.phone], ['Email', d.user.email ?? '—'],
                    ['Vínculo', lbl(d.profile?.link_type)], ['Estado', lbl(d.profile?.status)], ['Online', d.profile?.is_online ? 'Sim' : 'Não'],
                    ['Avaliação', d.profile?.rating_avg ? Number(d.profile.rating_avg).toFixed(2) : '—'],
                  ]}
                />
                <div className="row-end wrap">
                  {d.profile?.status === 'active' && <Button kind="danger" onClick={() => setDlg({ title: 'Suspender estafeta', path: `/admin/couriers/${id}/status`, body: { status: 'suspended' }, danger: true })}>Suspender</Button>}
                  {d.profile?.status === 'suspended' && <Button onClick={() => setDlg({ title: 'Reactivar estafeta', path: `/admin/couriers/${id}/status`, body: { status: 'active' } })}>Reactivar</Button>}
                  <Button kind="secondary" onClick={() => setDlg({ title: 'Registar liquidação do saldo pendente', path: '/admin/payouts', body: { courier_id: id } })}>Registar liquidação</Button>
                </div>
              </Card>
              {pendingApp && (
                <Card className="stack">
                  <h3>Candidatura pendente</h3>
                  <p className="small">Verifique os documentos e o veículo antes de aprovar. Quem se candidata não pode aprovar a própria candidatura.</p>
                  <Field label="Zona de trabalho (opcional)">
                    <select value={zone} onChange={(e) => setZone(e.target.value)}>
                      <option value="">—</option>
                      {(zones.data ?? []).filter((z) => z.kind === 'coverage').map((z) => (
                        <option key={z.id} value={z.id}>
                          {z.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div className="row-end">
                    <Button kind="danger" onClick={() => setDlg({ title: 'Rejeitar candidatura', path: `/admin/applications/${pendingApp.id}/review`, body: { decision: 'rejected' }, danger: true })}>Rejeitar</Button>
                    <Button onClick={() => setDlg({ title: 'Aprovar candidatura', path: `/admin/applications/${pendingApp.id}/review`, body: { decision: 'approved', zone_id: zone || undefined } })}>Aprovar</Button>
                  </div>
                </Card>
              )}
              <Card>
                <h3>Documentos</h3>
                <Table
                  head={['Tipo', 'Estado', 'Enviado', '']}
                  rows={d.documents.map((doc: any) => [
                    lbl(doc.kind), lbl(doc.status), dateTime(doc.created_at),
                    <span className="row-end">
                      <button className="link" onClick={() => download(api, `/admin/documents/${doc.id}/file`)}>Ver</button>
                      <button className="link" onClick={() => setDlg({ title: 'Aprovar documento', path: `/admin/documents/${doc.id}/review`, body: { status: 'approved' } })}>Aprovar</button>
                      <button className="link danger" onClick={() => setDlg({ title: 'Rejeitar documento', path: `/admin/documents/${doc.id}/review`, body: { status: 'rejected' }, danger: true })}>Rejeitar</button>
                    </span>,
                  ])}
                />
              </Card>
              <Card>
                <h3>Veículos</h3>
                <Table
                  head={['Tipo', 'Matrícula', 'Capacidade', 'Propriedade', 'Estado', '']}
                  rows={d.vehicles.map((v: any) => [
                    lbl(v.kind), v.plate ?? '—', `${v.capacity_kg} kg`, lbl(v.ownership), lbl(v.status),
                    <span className="row-end">
                      <button className="link" onClick={() => { setNum(String(v.capacity_kg)); setDlg({ title: 'Aprovar veículo', path: `/admin/vehicles/${v.id}/review`, body: { status: 'approved' }, extra: 'capacity' }); }}>Aprovar</button>
                      <button className="link danger" onClick={() => setDlg({ title: 'Rejeitar veículo', path: `/admin/vehicles/${v.id}/review`, body: { status: 'rejected' }, danger: true })}>Rejeitar</button>
                    </span>,
                  ])}
                />
              </Card>
              <Card>
                <h3>Contestações de ganhos</h3>
                <Table
                  head={['Mensagem', 'Valor', 'Estado', 'Data', '']}
                  rows={d.disputes.map((x: any) => [x.message, mt(x.amount_cents), lbl(x.status), dateTime(x.created_at),
                    x.status === 'open' ? <button className="link" onClick={() => { setNum('0'); setDlg({ title: 'Resolver contestação', path: `/admin/disputes/${x.id}/resolve`, body: {}, extra: 'adjust' }); }}>Resolver</button> : ''])}
                />
              </Card>
              <Card>
                <h3>Últimas tarefas</h3>
                <Table head={['Código', 'Estado', 'Actualizado']} rows={d.orders.map((o: any) => [<Link to={`/admin/encomendas/${o.id}`}>{o.code}</Link>, <StatusBadge status={o.status} />, dateTime(o.updated_at)])} />
              </Card>
              {dlg && (
                <Confirm
                  title={dlg.title}
                  reasonLabel={dlg.path === '/admin/payouts' ? 'Referência do pagamento (M-Pesa, banco…)' : 'Motivo (fica na auditoria)'}
                  danger={dlg.danger}
                  onClose={() => setDlg(null)}
                  onConfirm={async (reason) => {
                    const body: Record<string, unknown> = { ...dlg.body };
                    if (dlg.path === '/admin/payouts') body.reference = reason;
                    else body.reason = reason;
                    if (dlg.extra === 'capacity') body.capacity_kg = Number(num.replace(',', '.'));
                    if (dlg.extra === 'adjust') body.adjustment_cents = Math.round(Number(num.replace(',', '.')) * 100);
                    await api.post(dlg.path, body);
                    await q.reload();
                    return true;
                  }}
                >
                  {dlg.extra === 'capacity' && (
                    <Field label="Capacidade confirmada (kg, até 15)">
                      <input inputMode="decimal" value={num} onChange={(e) => setNum(e.target.value)} />
                    </Field>
                  )}
                  {dlg.extra === 'adjust' && (
                    <Field label="Ajuste em MT (0 se não houver; negativo para descontar)">
                      <input inputMode="decimal" value={num} onChange={(e) => setNum(e.target.value)} />
                    </Field>
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

// ------------------------------------------------------------------ 05 Encomendas
export function AdminOrders() {
  const { api } = useSession();
  const [sp, setSp] = useSearchParams();
  const status = sp.get('status') ?? '';
  const [text, setText] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const qs = `status=${status}&q=${encodeURIComponent(text)}&from=${from}&to=${to}`;
  const q = useLoad(() => api.get(`/admin/orders?${qs}&page=${page}`), [qs, page], 30_000);
  return (
    <Page title="Encomendas" wide actions={<Button kind="secondary" onClick={() => download(api, `/admin/orders/export.csv?${qs}`, 'encomendas.csv')}>Exportar CSV</Button>}>
      <div className="filters">
        <input placeholder="Código ou cliente" value={text} onChange={(e) => setText(e.target.value)} />
        <select value={status} onChange={(e) => setSp(e.target.value ? { status: e.target.value } : {})}>
          <option value="">Todos os estados</option>
          {Object.entries(STATUS_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <input type="date" aria-label="De" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" aria-label="Até" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <Loaded q={q}>
        {(d) => (
          <>
            <Table
              head={['Código', 'Estado', 'Cliente', 'Estafeta', 'Modalidade', 'Distância', 'Valor', 'Pagamento', 'Criado']}
              rows={d.items.map((o: any) => [
                <Link to={`/admin/encomendas/${o.id}`}>{o.code}</Link>, <StatusBadge status={o.status} />, o.customer, o.courier ?? '—', SERVICE[o.service_type],
                km(o.road_distance_m), mt(o.price_cents), `${PAY_METHOD[o.payment_method] ?? o.payment_method} · ${lbl(o.payment_status)}`, dateTime(o.created_at),
              ])}
            />
            <div className="row-between">
              <Button kind="ghost" disabled={page === 1} onClick={() => setPage(page - 1)}>Anteriores</Button>
              <Button kind="ghost" disabled={d.items.length < 50} onClick={() => setPage(page + 1)}>Seguintes</Button>
            </div>
          </>
        )}
      </Loaded>
    </Page>
  );
}

const OVERRIDES: [string, string][] = [
  ['CANCELADO', 'Cancelar'], ['PENDENTE_ATRIBUICAO', 'Voltar a pendente'], ['FALHA_ENTREGA', 'Marcar falha'], ['DEVOLUCAO_PENDENTE', 'Devolução pendente'], ['DEVOLVIDO', 'Marcar devolvido'], ['EM_TRANSPORTE', 'Retomar transporte'],
];

export function AdminOrderDetail() {
  const { id } = useParams();
  const { api } = useSession();
  const q = useLoad(() => api.get(`/admin/orders/${id}`), [id], 20_000);
  const eligible = useLoad(() => api.get<any[]>(`/admin/orders/${id}/eligible-couriers`), [id]);
  const [courier, setCourier] = useState('');
  const [dlg, setDlg] = useState<{ title: string; path: string; body: Record<string, unknown>; danger?: boolean } | null>(null);
  return (
    <Page title="Encomenda" back="/admin/encomendas" wide>
      <Loaded q={q}>
        {(o) => (
          <div className="grid-main">
            <div className="stack">
              <Card>
                <div className="row-between">
                  <h2>{o.code}</h2>
                  <StatusBadge status={o.status} label={o.status_label} />
                </div>
                <KV
                  items={[
                    ['Cliente', <Link to={`/admin/clientes/${o.customer_id}`}>{o.customer}</Link>],
                    ['Estafeta', o.courier ? <Link to={`/admin/estafetas/${o.assigned_courier_id}`}>{o.courier}</Link> : '—'],
                    ['Recolha', o.pickup.text], ['Entrega', o.dropoff.text], ['Destinatário', `${o.recipient_name} · ${o.recipient_phone}`],
                    ['Conteúdo', `${CATEGORIES[o.category] ?? o.category}: ${o.description}`], ['Observações', o.notes ?? '—'],
                    ['Peso', `${o.weight_kg} kg`], ['Distância por estrada', km(o.road_distance_m)], ['Modalidade', SERVICE[o.service_type]],
                    ['Valor', mt(o.price_cents)], ['Pagamento', `${PAY_METHOD[o.payment_method] ?? o.payment_method} · ${lbl(o.payment_status)}`],
                    ['Agendado', o.scheduled_at ? dateTime(o.scheduled_at) : '—'], ['Tentativas de código', o.delivery_code_attempts],
                    ...(o.cancel_reason ? ([['Motivo cancelamento', o.cancel_reason]] as [string, string][]) : []),
                  ]}
                />
              </Card>
              <MapView
                markers={[
                  { lat: o.pickup.lat, lon: o.pickup.lon, kind: 'pickup' },
                  { lat: o.dropoff.lat, lon: o.dropoff.lon, kind: 'dropoff' },
                  ...(o.location ? [{ lat: o.location.lat, lon: o.location.lon, kind: 'courier' as const }] : []),
                ]}
              />
              <Card>
                <h3>Preço calculado</h3>
                <KV items={[['Base', mt(o.pricing?.base_cents)], ['Distância', mt(o.pricing?.distance_cents)], ['Peso', mt(o.pricing?.weight_cents)], ['Ajuste mínimo', mt(o.pricing?.minimum_adjust_cents)], ['Total', mt(o.pricing?.total_cents)]]} />
              </Card>
              <Card>
                <h3>Pagamentos</h3>
                <Table head={['Método', 'Estado', 'Valor', 'Referência', 'Data']} rows={o.payments.map((p: any) => [PAY_METHOD[p.provider] ?? p.provider, lbl(p.status), mt(p.amount_cents), p.provider_ref ?? '—', dateTime(p.created_at)])} />
              </Card>
              <Card>
                <h3>Provas</h3>
                <Table head={['Momento', 'Método', 'Lista', 'Foto', 'Data']} rows={o.proofs.map((p: any) => [p.kind === 'pickup' ? 'Recolha' : 'Entrega', lbl(p.method), JSON.parse(p.checklist ?? '[]').join('; '), p.has_photo ? 'Sim' : 'Não', dateTime(p.created_at)])} />
              </Card>
              <Card>
                <h3>Incidentes</h3>
                <Table
                  head={['Tipo', 'Descrição', 'Estado', 'Data', '']}
                  rows={o.incidents.map((i: any) => [lbl(i.kind), i.description, lbl(i.status), dateTime(i.created_at), i.status !== 'resolved' ? <button className="link" onClick={() => setDlg({ title: 'Resolver incidente', path: `/admin/incidents/${i.id}/resolve`, body: {} })}>Resolver</button> : ''])}
                />
              </Card>
            </div>
            <div className="stack">
              {['PENDENTE_ATRIBUICAO', 'ATRIBUIDO', 'ACEITE'].includes(o.status) && (
                <Card className="stack">
                  <h3>{o.courier ? 'Reatribuir' : 'Atribuir'} estafeta</h3>
                  <Loaded q={eligible}>
                    {(list) =>
                      list.length === 0 ? (
                        <p className="small">Nenhum estafeta elegível (activo, veículo aprovado com capacidade e sem entrega em curso).</p>
                      ) : (
                        <select value={courier} onChange={(e) => setCourier(e.target.value)}>
                          <option value="">Escolha…</option>
                          {list.map((c) => (
                            <option key={c.user_id} value={c.user_id}>
                              {c.name} · {c.capacity_kg} kg {c.online ? '· online' : '· offline'}
                            </option>
                          ))}
                        </select>
                      )
                    }
                  </Loaded>
                  <Button disabled={!courier} onClick={() => setDlg({ title: 'Atribuir encomenda', path: `/admin/orders/${id}/assign`, body: { courier_id: courier } })}>
                    Atribuir
                  </Button>
                </Card>
              )}
              {!['ENTREGUE', 'CANCELADO', 'DEVOLVIDO'].includes(o.status) && (
                <Card className="stack">
                  <h3>Alterar estado</h3>
                  <p className="small">Use só em excepções. Fica registado com o motivo. Estados finais não se alteram.</p>
                  <div className="chips">
                    {OVERRIDES.map(([to, label]) => (
                      <button key={to} className="chip" onClick={() => setDlg({ title: label, path: `/admin/orders/${id}/status`, body: { to }, danger: to === 'CANCELADO' })}>
                        {label}
                      </button>
                    ))}
                  </div>
                </Card>
              )}
              <Card>
                <h3>Linha temporal</h3>
                <Timeline events={o.events} />
              </Card>
              <Card>
                <h3>Atribuições</h3>
                <Table head={['Estafeta', 'Estado', 'Motivo']} rows={o.assignments.map((a: any) => [a.courier, lbl(a.status), a.reason ?? ''])} />
              </Card>
            </div>
            {dlg && (
              <Confirm
                title={dlg.title}
                reasonLabel="Motivo (fica na auditoria)"
                danger={dlg.danger}
                onClose={() => setDlg(null)}
                onConfirm={async (reason) => {
                  await api.post(dlg.path, { ...dlg.body, reason });
                  await Promise.all([q.reload(), eligible.reload()]);
                  return true;
                }}
              />
            )}
          </div>
        )}
      </Loaded>
      <ErrorBox error={null} />
    </Page>
  );
}
