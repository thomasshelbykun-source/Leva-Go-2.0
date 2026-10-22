import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { dateTime, km, lbl, PAY_METHOD, mt, SERVICE, todayMaputo, WEEKDAYS } from '../shared/format';
import { MapView } from '../shared/map';
import { useSession } from '../shared/session';
import { Badge, Button, Card, Confirm, ErrorBox, Field, KV, Loaded, Notice, Page, Tabs, useAction, useLoad } from '../shared/ui';
import { download, Stat, Table } from './common';
import { DateRange } from './Operations';

const toCents = (s: string) => Math.round(Number(String(s).replace(',', '.')) * 100);
const fromCents = (n: number) => String((n ?? 0) / 100);

// ------------------------------------------------------------------ 06 Subscrições
export function Subscriptions() {
  const { api } = useSession();
  const q = useLoad(() => api.get('/admin/plans'), []);
  const [tab, setTab] = useState<'planos' | 'subscricoes' | 'faturas'>('planos');
  const empty = { id: '', name: '', description: '', price: '', period_days: '30', deliveries_included: '10', max_weight_kg: '15', service_types: ['normal'] as string[] };
  const [form, setForm] = useState<typeof empty | null>(null);
  const save = useAction();
  const [dlg, setDlg] = useState<{ title: string; path: string; body: Record<string, unknown>; danger?: boolean } | null>(null);
  return (
    <Page title="Subscrições" wide actions={<Button onClick={() => setForm(empty)}>Novo plano</Button>}>
      <Tabs value={tab} onChange={setTab} options={[['planos', 'Planos'], ['subscricoes', 'Subscrições'], ['faturas', 'Faturas']]} />
      {form && (
        <Card className="stack">
          <h3>{form.id ? 'Editar rascunho' : 'Novo plano (rascunho)'}</h3>
          <div className="grid-3">
            <Field label="Nome"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Preço (MT)"><input inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></Field>
            <Field label="Período (dias)"><input inputMode="numeric" value={form.period_days} onChange={(e) => setForm({ ...form, period_days: e.target.value })} /></Field>
            <Field label="Entregas incluídas"><input inputMode="numeric" value={form.deliveries_included} onChange={(e) => setForm({ ...form, deliveries_included: e.target.value })} /></Field>
            <Field label="Peso máximo (kg)"><input inputMode="decimal" value={form.max_weight_kg} onChange={(e) => setForm({ ...form, max_weight_kg: e.target.value })} /></Field>
            <Field label="Modalidades">
              <div className="chips">
                {['normal', 'expressa'].map((s) => (
                  <label key={s} className="check">
                    <input type="checkbox" checked={form.service_types.includes(s)} onChange={(e) => setForm({ ...form, service_types: e.target.checked ? [...form.service_types, s] : form.service_types.filter((x) => x !== s) })} /> {SERVICE[s]}
                  </label>
                ))}
              </div>
            </Field>
          </div>
          <Field label="Descrição"><textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <ErrorBox error={save.error} />
          <div className="row-end">
            <Button kind="ghost" onClick={() => setForm(null)}>Cancelar</Button>
            <Button
              busy={save.busy}
              onClick={async () => {
                const body = { name: form.name, description: form.description, price_cents: toCents(form.price), period_days: Number(form.period_days), deliveries_included: Number(form.deliveries_included), max_weight_kg: Number(form.max_weight_kg.replace(',', '.')), service_types: form.service_types };
                if (await save.run(() => (form.id ? api.put(`/admin/plans/${form.id}`, body) : api.post('/admin/plans', body)))) {
                  setForm(null);
                  q.reload();
                }
              }}
            >
              Guardar rascunho
            </Button>
          </div>
        </Card>
      )}
      <Loaded q={q}>
        {(d) => (
          <>
            {tab === 'planos' && (
              <Table
                head={['Plano', 'Preço', 'Entregas', 'Período', 'Peso', 'Modalidades', 'Estado', 'Activos', '']}
                rows={d.plans.map((p: any) => [
                  p.name, mt(p.price_cents), p.deliveries_included, `${p.period_days} d`, `${p.max_weight_kg} kg`, p.service_types.map((s: string) => SERVICE[s]).join(', '),
                  <Badge tone={p.status === 'published' ? 'ok' : p.status === 'draft' ? 'warn' : 'muted'}>{lbl(p.status)}</Badge>, p.active_subscribers,
                  <span className="row-end">
                    {p.status === 'draft' && <button className="link" onClick={() => setForm({ id: p.id, name: p.name, description: p.description ?? '', price: fromCents(p.price_cents), period_days: String(p.period_days), deliveries_included: String(p.deliveries_included), max_weight_kg: String(p.max_weight_kg), service_types: p.service_types })}>Editar</button>}
                    {p.status !== 'published' && <button className="link" onClick={() => setDlg({ title: `Publicar ${p.name}`, path: `/admin/plans/${p.id}/status`, body: { status: 'published' } })}>Publicar</button>}
                    {p.status === 'published' && <button className="link danger" onClick={() => setDlg({ title: `Arquivar ${p.name}`, path: `/admin/plans/${p.id}/status`, body: { status: 'archived' }, danger: true })}>Arquivar</button>}
                  </span>,
                ])}
              />
            )}
            {tab === 'subscricoes' && (
              <Table
                head={['Cliente', 'Plano', 'Estado', 'Uso', 'Fim do período', 'Renova', '']}
                rows={d.subscriptions.map((s: any) => [
                  s.customer, s.plan, lbl(s.status), s.deliveries_total != null ? `${s.deliveries_used}/${s.deliveries_total}` : '—', dateTime(s.current_period_end), s.auto_renew ? 'Sim' : 'Não',
                  s.status === 'active' ? (
                    <span className="row-end">
                      <button className="link" onClick={() => setDlg({ title: 'Cancelar renovação', path: `/admin/subscriptions/${s.id}/cancel`, body: { immediate: false } })}>Sem renovação</button>
                      <button className="link danger" onClick={() => setDlg({ title: 'Cancelar já', path: `/admin/subscriptions/${s.id}/cancel`, body: { immediate: true }, danger: true })}>Cancelar já</button>
                    </span>
                  ) : '',
                ])}
              />
            )}
            {tab === 'faturas' && <Table head={['Número', 'Cliente', 'Valor', 'Estado', 'Data']} rows={d.invoices.map((i: any) => [i.number ?? i.id.slice(0, 8), i.customer, mt(i.amount_cents), lbl(i.status), dateTime(i.created_at)])} />}
          </>
        )}
      </Loaded>
      {dlg && (
        <Confirm title={dlg.title} reasonLabel="Motivo (fica na auditoria)" danger={dlg.danger} onClose={() => setDlg(null)} onConfirm={async (reason) => { await api.post(dlg.path, { ...dlg.body, reason }); await q.reload(); return true; }} />
      )}
    </Page>
  );
}

// ------------------------------------------------------------------ 07 Pagamentos
export function Payments() {
  const { me, api } = useSession();
  const [status, setStatus] = useState('');
  const q = useLoad(() => api.get(`/admin/payments${status ? `?status=${status}` : ''}`), [status]);
  const [dlg, setDlg] = useState<{ title: string; path: string; body: Record<string, unknown>; amount?: boolean; danger?: boolean } | null>(null);
  const [amount, setAmount] = useState('');
  return (
    <Page title="Pagamentos" wide>
      <Notice>M-Pesa e e-Mola ficam simulados até existirem as integrações oficiais. Nunca guardamos PIN.</Notice>
      <Loaded q={q}>
        {(d) => (
          <div className="stack">
            <div className="stats">
              <Stat label="Confirmado" value={mt(d.totals?.succeeded)} tone="ok" />
              <Stat label="Pendente" value={mt(d.totals?.pending)} tone="warn" />
              <Stat label="Reembolsado" value={mt(d.totals?.refunded)} />
            </div>
            <Card>
              <h3>Reembolsos</h3>
              <p className="small">Dupla validação: quem pede o reembolso não o pode aprovar.</p>
              <Table
                head={['Valor', 'Motivo', 'Pedido por', 'Aprovado por', 'Estado', 'Data', '']}
                rows={d.refunds.map((r: any) => [
                  mt(r.amount_cents), r.reason, r.requested_by_name, r.approved_by_name ?? '—', lbl(r.status), dateTime(r.created_at),
                  r.status === 'requested' && r.requested_by !== me?.id ? (
                    <span className="row-end">
                      <button className="link" onClick={() => setDlg({ title: 'Aprovar reembolso', path: `/admin/refunds/${r.id}/decide`, body: { decision: 'approved' } })}>Aprovar</button>
                      <button className="link danger" onClick={() => setDlg({ title: 'Rejeitar reembolso', path: `/admin/refunds/${r.id}/decide`, body: { decision: 'rejected' }, danger: true })}>Rejeitar</button>
                    </span>
                  ) : r.status === 'requested' ? <small>Aguarda outro admin</small> : '',
                ])}
              />
            </Card>
            <div className="filters">
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Todos</option>
                <option value="pending">Pendentes</option>
                <option value="succeeded">Confirmados</option>
                <option value="failed">Falhados</option>
                <option value="refunded">Reembolsados</option>
              </select>
            </div>
            <Table
              head={['Cliente', 'Encomenda', 'Método', 'Estado', 'Valor', 'Referência', 'Data', '']}
              rows={d.intents.map((p: any) => [
                p.customer, p.order_code ?? (p.subscription_id ? 'Subscrição' : '—'), PAY_METHOD[p.provider] ?? p.provider, lbl(p.status), mt(p.amount_cents), p.provider_ref ?? '—', dateTime(p.created_at),
                p.status === 'succeeded' ? <button className="link" onClick={() => { setAmount(String(p.amount_cents / 100)); setDlg({ title: 'Pedir reembolso', path: `/admin/payments/${p.id}/refunds`, body: {}, amount: true }); }}>Reembolsar</button> : p.failure_reason ?? '',
              ])}
            />
          </div>
        )}
      </Loaded>
      {dlg && (
        <Confirm
          title={dlg.title}
          reasonLabel="Motivo (fica na auditoria)"
          danger={dlg.danger}
          onClose={() => setDlg(null)}
          onConfirm={async (reason) => {
            await api.post(dlg.path, { ...dlg.body, reason, ...(dlg.amount ? { amount_cents: toCents(amount) } : {}) });
            await q.reload();
            return true;
          }}
        >
          {dlg.amount && <Field label="Valor (MT)"><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>}
        </Confirm>
      )}
    </Page>
  );
}

// ------------------------------------------------------------------ 08 Tarifas
type Rule = { service_type: 'normal' | 'expressa'; base: string; per_km: string; per_kg: string; min: string };
const toRules = (r: Rule[]) => r.map((x) => ({ service_type: x.service_type, base_cents: toCents(x.base), per_km_cents: toCents(x.per_km), per_kg_cents: toCents(x.per_kg), min_total_cents: toCents(x.min) }));

export function Pricing() {
  const { api } = useSession();
  const q = useLoad(() => api.get<any[]>('/admin/pricing'), []);
  const [rules, setRules] = useState<Rule[]>([
    { service_type: 'normal', base: '', per_km: '', per_kg: '', min: '' },
    { service_type: 'expressa', base: '', per_km: '', per_kg: '', min: '' },
  ]);
  const [note, setNote] = useState('');
  const [sim, setSim] = useState({ distance_km: '5', weight_kg: '2' });
  const [simOut, setSimOut] = useState<any[] | null>(null);
  const a = useAction();
  const [publish, setPublish] = useState<any | null>(null);
  const [approved, setApproved] = useState(false);
  const set = (i: number, k: keyof Rule, v: string) => setRules(rules.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <Page title="Tarifas" wide>
      <Notice tone="warn">Os valores da tabela de preços ainda dependem de aprovação da direcção. Publique só valores aprovados.</Notice>
      <Card className="stack">
        <h3>Nova versão (rascunho)</h3>
        <Table
          head={['Modalidade', 'Base (MT)', 'Por km (MT)', 'Por kg extra (MT)', 'Mínimo (MT)']}
          rows={rules.map((r, i) => [
            SERVICE[r.service_type],
            ...(['base', 'per_km', 'per_kg', 'min'] as const).map((k) => <input key={k} inputMode="decimal" aria-label={k} value={r[k]} onChange={(e) => set(i, k, e.target.value)} />),
          ])}
        />
        <small>Fórmula: base + por km × distância por estrada + por kg × (kg arredondados − 1), nunca abaixo do mínimo.</small>
        <div className="row-end wrap">
          <Field label="Simular distância (km)"><input inputMode="decimal" value={sim.distance_km} onChange={(e) => setSim({ ...sim, distance_km: e.target.value })} /></Field>
          <Field label="Peso (kg)"><input inputMode="decimal" value={sim.weight_kg} onChange={(e) => setSim({ ...sim, weight_kg: e.target.value })} /></Field>
          <Button kind="secondary" busy={a.busy} onClick={async () => setSimOut((await a.run(() => api.post<any[]>('/admin/pricing/simulate', { rules: toRules(rules), distance_km: Number(sim.distance_km.replace(',', '.')), weight_kg: Number(sim.weight_kg.replace(',', '.')) }))) ?? null)}>Simular</Button>
        </div>
        {simOut && <Table head={['Modalidade', 'Base', 'Distância', 'Peso', 'Ajuste', 'Total']} rows={simOut.map((s) => [SERVICE[s.service_type], mt(s.base_cents), mt(s.distance_cents), mt(s.weight_cents), mt(s.minimum_adjust_cents), <strong>{mt(s.total_cents)}</strong>])} />}
        <Field label="Nota da versão (ex.: aprovada em reunião de 20/10)"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <ErrorBox error={a.error} />
        <Button busy={a.busy} disabled={note.length < 3} onClick={async () => (await a.run(() => api.post('/admin/pricing', { note, rules: toRules(rules) }))) && q.reload()}>Guardar rascunho</Button>
      </Card>
      <Loaded q={q}>
        {(versions) => (
          <Table
            head={['Versão', 'Estado', 'Nota', 'Normal', 'Expressa', 'Publicada', '']}
            rows={versions.map((v) => {
              const r = (t: string) => v.rules.find((x: any) => x.service_type === t);
              const fmt = (x: any) => (x ? `${mt(x.base_cents)} + ${mt(x.per_km_cents)}/km (mín. ${mt(x.min_total_cents)})` : '—');
              return [
                `v${v.version}`, <Badge tone={v.status === 'published' ? 'ok' : v.status === 'draft' ? 'warn' : 'muted'}>{lbl(v.status)}</Badge>, v.note, fmt(r('normal')), fmt(r('expressa')),
                v.published_at ? `${dateTime(v.published_at)} · ${v.published_by_name ?? ''}` : '—',
                v.status === 'draft' ? <button className="link" onClick={() => { setApproved(false); setPublish(v); }}>Publicar</button> : '',
              ];
            })}
          />
        )}
      </Loaded>
      {publish && (
        <Confirm
          title={`Publicar v${publish.version}?`}
          text="A versão publicada passa a valer para novas cotações. Encomendas já feitas mantêm o preço original."
          reasonLabel="Motivo (fica na auditoria)"
          onClose={() => setPublish(null)}
          onConfirm={async (reason) => {
            await api.post(`/admin/pricing/${publish.id}/publish`, { approved_confirmation: approved, reason });
            await q.reload();
            return true;
          }}
        >
          <label className="check"><input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} /> Confirmo que estes valores foram aprovados pela direcção.</label>
        </Confirm>
      )}
    </Page>
  );
}

// ------------------------------------------------------------------ 09 Zonas
export function Zones() {
  const { api } = useSession();
  const q = useLoad(() => api.get<any[]>('/admin/zones'), []);
  const [edit, setEdit] = useState<{ id?: string; name: string; kind: 'coverage' | 'restricted'; active: boolean; polygon: [number, number][] } | null>(null);
  const [test, setTest] = useState<{ from?: { lat: number; lon: number }; to?: { lat: number; lon: number }; out?: any }>({});
  const [mode, setMode] = useState<'ver' | 'desenhar' | 'testar'>('ver');
  const [reason, setReason] = useState('');
  const a = useAction();
  const click = async (lat: number, lon: number) => {
    if (mode === 'desenhar' && edit) setEdit({ ...edit, polygon: [...edit.polygon, [lon, lat]] });
    if (mode === 'testar') {
      if (!test.from || test.to) setTest({ from: { lat, lon } });
      else {
        const to = { lat, lon };
        const out = await a.run(() => api.post('/admin/zones/test-route', { from: test.from, to }));
        setTest({ ...test, to, out });
      }
    }
  };
  return (
    <Page title="Zonas de cobertura" wide>
      <Loaded q={q}>
        {(zones) => (
          <div className="grid-main">
            <div className="stack">
              <Tabs value={mode} onChange={(m) => { setMode(m); if (m === 'testar') setTest({}); }} options={[['ver', 'Ver'], ['desenhar', 'Desenhar zona'], ['testar', 'Testar rota']]} />
              {mode === 'desenhar' && !edit && <Notice>Escolha uma zona para editar ou crie uma nova.</Notice>}
              {mode === 'desenhar' && edit && <Notice>Toque no mapa para juntar pontos ao polígono ({edit.polygon.length} pontos).</Notice>}
              {mode === 'testar' && <Notice>Toque no ponto de partida e depois no destino.</Notice>}
              <MapView
                height={460}
                polygons={[...zones.filter((z) => z.id !== edit?.id), ...(edit && edit.polygon.length > 2 ? [{ polygon: edit.polygon, kind: edit.kind, name: edit.name }] : [])]}
                markers={[
                  ...(mode === 'desenhar' && edit ? edit.polygon.map(([lon, lat]) => ({ lat, lon, kind: 'area' as const })) : []),
                  ...(test.from ? [{ ...test.from, kind: 'pickup' as const }] : []),
                  ...(test.to ? [{ ...test.to, kind: 'dropoff' as const }] : []),
                ]}
                route={test.out?.route?.geometry}
                onClick={(lat, lon) => void click(lat, lon)}
              />
              {test.out && (
                <Card>
                  <KV items={[['Distância por estrada', km(test.out.route.distance_m)], ['Fonte', test.out.route.provider], ['Dentro do limite de 15 km', test.out.within_limit ? 'Sim' : `Não: ${test.out.message}`], ['Partida', test.out.from_zones.join(', ') || 'Fora de zonas'], ['Destino', test.out.to_zones.join(', ') || 'Fora de zonas']]} />
                </Card>
              )}
              <ErrorBox error={a.error} />
            </div>
            <div className="stack">
              <Button onClick={() => { setMode('desenhar'); setEdit({ name: '', kind: 'coverage', active: true, polygon: [] }); }}>Nova zona</Button>
              {edit && (
                <Card className="stack">
                  <Field label="Nome"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
                  <Field label="Tipo">
                    <select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as 'coverage' })}>
                      <option value="coverage">Cobertura</option>
                      <option value="restricted">Restrita (sem serviço)</option>
                    </select>
                  </Field>
                  {edit.id && <label className="check"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Activa</label>}
                  <Field label="Motivo da alteração"><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
                  <div className="row-end">
                    <Button kind="ghost" onClick={() => setEdit({ ...edit, polygon: [] })}>Limpar pontos</Button>
                    <Button kind="ghost" onClick={() => setEdit(null)}>Cancelar</Button>
                    <Button
                      busy={a.busy}
                      disabled={edit.polygon.length < 3 || reason.length < 3 || edit.name.length < 2}
                      onClick={async () => {
                        const poly = [...edit.polygon];
                        if (JSON.stringify(poly[0]) !== JSON.stringify(poly.at(-1))) poly.push(poly[0]!);
                        const body = { name: edit.name, kind: edit.kind, polygon: poly, reason, active: edit.active, city: 'Quelimane' };
                        if (await a.run(() => (edit.id ? api.put(`/admin/zones/${edit.id}`, body) : api.post('/admin/zones', body)))) {
                          setEdit(null);
                          setReason('');
                          setMode('ver');
                          q.reload();
                        }
                      }}
                    >
                      Guardar
                    </Button>
                  </div>
                </Card>
              )}
              {zones.map((z) => (
                <Card key={z.id}>
                  <div className="row-between">
                    <strong>{z.name}</strong>
                    <Badge tone={!z.active ? 'muted' : z.kind === 'coverage' ? 'ok' : 'bad'}>{!z.active ? 'Inactiva' : z.kind === 'coverage' ? 'Cobertura' : 'Restrita'}</Badge>
                  </div>
                  <small>Versão {z.version} · {dateTime(z.updated_at)}</small>
                  <button className="link" onClick={() => { setMode('desenhar'); setEdit({ id: z.id, name: z.name, kind: z.kind, active: !!z.active, polygon: z.polygon.slice(0, -1) }); }}>Editar</button>
                </Card>
              ))}
            </div>
          </div>
        )}
      </Loaded>
    </Page>
  );
}

// ------------------------------------------------------------------ 10 Suporte
export function Tickets() {
  const { api } = useSession();
  const [status, setStatus] = useState('');
  const q = useLoad(() => api.get<any[]>(`/admin/tickets${status ? `?status=${status}` : ''}`), [status], 60_000);
  return (
    <Page title="Reclamações e apoio" wide>
      <div className="filters">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos</option>
          <option value="aberto">Abertos</option>
          <option value="em_curso">Em curso</option>
          <option value="resolvido">Resolvidos</option>
          <option value="fechado">Fechados</option>
        </select>
      </div>
      <Loaded q={q}>
        {(rows) => (
          <Table
            head={['Assunto', 'Aberto por', 'Perfil', 'Prioridade', 'Estado', 'Responsável', 'Prazo', '']}
            rows={rows.map((t) => [
              t.subject, t.opener, t.opener_role === 'courier' ? 'Estafeta' : 'Cliente', lbl(t.priority), lbl(t.status), t.assignee ?? '—',
              <span className={t.sla_due_at < new Date().toISOString() && ['aberto', 'em_curso'].includes(t.status) ? 'danger' : ''}>{dateTime(t.sla_due_at)}</span>,
              <Link to={`/admin/suporte/${t.id}`}>Abrir</Link>,
            ])}
          />
        )}
      </Loaded>
    </Page>
  );
}

export function TicketDetail() {
  const { id } = useParams();
  const { api, me } = useSession();
  const q = useLoad(() => api.get(`/admin/tickets/${id}`), [id]);
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const a = useAction();
  const patch = (b: Record<string, unknown>) => a.run(() => api.patch(`/admin/tickets/${id}`, b)).then(() => q.reload());
  return (
    <Page title="Caso de apoio" back="/admin/suporte" wide>
      <Loaded q={q}>
        {(t) => (
          <div className="grid-main">
            <Card className="stack">
              <h2>{t.subject}</h2>
              <div className="chat">
                {t.messages.map((m: any) => (
                  <div key={m.id} className={`msg ${m.author_id === t.opened_by ? '' : 'mine'} ${m.internal ? 'internal' : ''}`}>
                    <small>{m.author}{m.internal ? ' · nota interna' : ''}</small>
                    <p>{m.body}</p>
                    <small>{dateTime(m.created_at)}</small>
                  </div>
                ))}
              </div>
              <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Resposta" />
              <label className="check"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Nota interna (o cliente não vê)</label>
              <ErrorBox error={a.error} />
              <Button busy={a.busy} disabled={!body.trim()} onClick={async () => (await a.run(() => api.post(`/admin/tickets/${id}/messages`, { body, internal }))) && (setBody(''), q.reload())}>Enviar</Button>
            </Card>
            <Card className="stack">
              <KV items={[['Aberto por', t.opener], ['Perfil', t.opener_role], ['Encomenda', t.order_id ? <Link to={`/admin/encomendas/${t.order_id}`}>Ver</Link> : '—'], ['Prazo', dateTime(t.sla_due_at)], ['Criado', dateTime(t.created_at)]]} />
              <Field label="Estado">
                <select value={t.status} onChange={(e) => patch({ status: e.target.value })}>
                  <option value="aberto">Aberto</option>
                  <option value="em_curso">Em curso</option>
                  <option value="resolvido">Resolvido</option>
                  <option value="fechado">Fechado</option>
                </select>
              </Field>
              <Field label="Prioridade">
                <select value={t.priority} onChange={(e) => patch({ priority: e.target.value })}>
                  <option value="baixa">Baixa (72 h)</option>
                  <option value="normal">Normal (24 h)</option>
                  <option value="alta">Alta (8 h)</option>
                  <option value="urgente">Urgente (2 h)</option>
                </select>
              </Field>
              {t.assignee_id !== me?.id && <Button kind="secondary" onClick={() => patch({ assignee_id: me?.id })}>Ficar responsável</Button>}
            </Card>
          </div>
        )}
      </Loaded>
    </Page>
  );
}

// ------------------------------------------------------------------ 11 Relatórios
const REPORTS: [string, string][] = [['operacional', 'Operacional'], ['financeiro', 'Financeiro'], ['subscricoes', 'Subscrições'], ['desempenho', 'Desempenho dos estafetas']];
export function Reports() {
  const { api } = useSession();
  const [kind, setKind] = useState('operacional');
  const [from, setFrom] = useState(todayMaputo(-29));
  const [to, setTo] = useState(todayMaputo());
  const q = useLoad(() => api.get(`/admin/reports/${kind}?from=${from}&to=${to}`), [kind, from, to]);
  return (
    <Page title="Relatórios" wide actions={<Button kind="secondary" onClick={() => download(api, `/admin/reports/${kind}?from=${from}&to=${to}&format=csv`, `relatorio-${kind}.csv`)}>Exportar CSV</Button>}>
      <div className="filters">
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          {REPORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
      </div>
      <Loaded q={q}>
        {(d) => <Table head={d.rows[0] ? Object.keys(d.rows[0]).map((k) => k.replace(/_/g, ' ')) : ['Resultado']} rows={d.rows.map((r: any) => Object.values(r).map((v) => String(v ?? '')))} empty="Sem dados no período." />}
      </Loaded>
    </Page>
  );
}

// ------------------------------------------------------------------ 12 Definições
const SETTING_LABELS: Record<string, string> = { company: 'Empresa', limits: 'Limites (só super-admin)', payments: 'Pagamentos (só super-admin)', courier_pay: 'Remuneração dos estafetas', scheduling: 'Agendamento', service_types: 'Modalidades', app: 'Aplicação' };

export function Settings() {
  const { api, me } = useSession();
  const q = useLoad(() => api.get('/admin/settings'), []);
  const [tab, setTab] = useState<'geral' | 'horario' | 'admins' | 'auditoria'>('geral');
  const [edit, setEdit] = useState<{ key: string; text: string } | null>(null);
  const [hours, setHours] = useState<{ weekday: number; opens_at: string; closes_at: string }[] | null>(null);
  const [admin, setAdmin] = useState({ phone: '', role: 'admin', grant: true });
  const [dlg, setDlg] = useState<'setting' | 'hours' | 'admin' | null>(null);
  const audit = useLoad(() => (tab === 'auditoria' ? api.get<any[]>('/admin/audit') : Promise.resolve([])), [tab]);
  const isSuper = me?.roles.includes('super_admin');
  return (
    <Page title="Definições" wide>
      <Tabs value={tab} onChange={setTab} options={[['geral', 'Geral'], ['horario', 'Horário'], ['admins', 'Administradores'], ['auditoria', 'Auditoria']]} />
      <Loaded q={q}>
        {(d) => (
          <div className="stack">
            {tab === 'geral' &&
              d.settings.map((s: any) => (
                <Card key={s.key} className="stack">
                  <div className="row-between">
                    <h3>{SETTING_LABELS[s.key] ?? s.key}</h3>
                    <small>v{s.version} · {dateTime(s.updated_at)} {s.updated_by ? `· ${s.updated_by}` : ''}</small>
                  </div>
                  {edit?.key === s.key ? (
                    <>
                      <textarea className="mono" rows={8} value={edit!.text} onChange={(e) => setEdit({ ...edit!, text: e.target.value })} />
                      <div className="row-end">
                        <Button kind="ghost" onClick={() => setEdit(null)}>Cancelar</Button>
                        <Button onClick={() => setDlg('setting')}>Guardar</Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <KV items={Object.entries(s.value).map(([k, v]) => [k.replace(/_/g, ' '), typeof v === 'object' ? JSON.stringify(v) : String(v)])} />
                      {(isSuper || !['limits', 'payments'].includes(s.key)) && <Button kind="secondary" onClick={() => setEdit({ key: s.key, text: JSON.stringify(s.value, null, 2) })}>Editar</Button>}
                    </>
                  )}
                </Card>
              ))}
            {tab === 'horario' && (
              <Card className="stack">
                <p className="small">Horário aprovado: domingo a quinta 07:00–22:00, sexta 07:00–16:00, sábado 17:00–22:00 (hora de Maputo).</p>
                {(hours ?? d.hours).map((h: any, i: number) => (
                  <div key={i} className="row-between">
                    <select value={h.weekday} onChange={(e) => setHours((hours ?? d.hours).map((x: any, j: number) => (j === i ? { ...x, weekday: Number(e.target.value) } : x)))}>
                      {WEEKDAYS.map((w, k) => <option key={k} value={k}>{w}</option>)}
                    </select>
                    <input type="time" value={h.opens_at} onChange={(e) => setHours((hours ?? d.hours).map((x: any, j: number) => (j === i ? { ...x, opens_at: e.target.value } : x)))} />
                    <input type="time" value={h.closes_at} onChange={(e) => setHours((hours ?? d.hours).map((x: any, j: number) => (j === i ? { ...x, closes_at: e.target.value } : x)))} />
                    <button className="link danger" onClick={() => setHours((hours ?? d.hours).filter((_: any, j: number) => j !== i))}>Remover</button>
                  </div>
                ))}
                <div className="row-end">
                  <Button kind="ghost" onClick={() => setHours([...(hours ?? d.hours), { weekday: 0, opens_at: '07:00', closes_at: '22:00' }])}>Juntar período</Button>
                  <Button disabled={!hours} onClick={() => setDlg('hours')}>Guardar horário</Button>
                </div>
              </Card>
            )}
            {tab === 'admins' && (
              <>
                <Table head={['Nome', 'Telemóvel', 'Papel', 'Desde']} rows={d.admins.map((x: any) => [x.name, x.phone, x.role === 'super_admin' ? 'Super-admin' : 'Admin', dateTime(x.created_at)])} />
                {isSuper ? (
                  <Card className="stack">
                    <h3>Dar ou retirar acesso</h3>
                    <p className="small">A pessoa precisa de ter conta (registo na app Cliente). Não pode alterar o seu próprio acesso.</p>
                    <div className="grid-3">
                      <Field label="Telemóvel"><input inputMode="tel" value={admin.phone} onChange={(e) => setAdmin({ ...admin, phone: e.target.value })} /></Field>
                      <Field label="Papel">
                        <select value={admin.role} onChange={(e) => setAdmin({ ...admin, role: e.target.value })}>
                          <option value="admin">Admin</option>
                          <option value="super_admin">Super-admin</option>
                        </select>
                      </Field>
                      <Field label="Acção">
                        <select value={admin.grant ? 'g' : 'r'} onChange={(e) => setAdmin({ ...admin, grant: e.target.value === 'g' })}>
                          <option value="g">Dar acesso</option>
                          <option value="r">Retirar acesso</option>
                        </select>
                      </Field>
                    </div>
                    <Button disabled={admin.phone.length < 9} onClick={() => setDlg('admin')}>Aplicar</Button>
                  </Card>
                ) : (
                  <Notice>Só o super-administrador gere administradores.</Notice>
                )}
              </>
            )}
            {tab === 'auditoria' && (
              <Loaded q={audit}>
                {(rows) => <Table head={['Data', 'Quem', 'Papel', 'Acção', 'Entidade', 'Motivo']} rows={rows.map((r) => [dateTime(r.created_at), r.actor ?? 'Sistema', r.actor_role, r.action, `${r.entity}${r.entity_id ? ` ${String(r.entity_id).slice(0, 8)}` : ''}`, r.reason ?? ''])} />}
              </Loaded>
            )}
          </div>
        )}
      </Loaded>
      {dlg && (
        <Confirm
          title={dlg === 'setting' ? 'Guardar definição' : dlg === 'hours' ? 'Guardar horário' : 'Alterar acesso de administrador'}
          reasonLabel="Motivo (fica na auditoria)"
          onClose={() => setDlg(null)}
          onConfirm={async (reason) => {
            if (dlg === 'setting' && edit) {
              let value: unknown;
              try {
                value = JSON.parse(edit.text);
              } catch {
                throw new Error('O texto não é JSON válido.');
              }
              await api.put(`/admin/settings/${edit.key}`, { value, reason });
              setEdit(null);
            }
            if (dlg === 'hours') {
              await api.put('/admin/hours', { hours, reason });
              setHours(null);
            }
            if (dlg === 'admin') await api.post('/admin/admins', { ...admin, reason });
            await q.reload();
            return true;
          }}
        />
      )}
    </Page>
  );
}
