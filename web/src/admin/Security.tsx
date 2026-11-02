import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { dateTime, lbl, mt } from '../shared/format';
import { useSession } from '../shared/session';
import { Badge, Button, Card, ErrorBox, Field, KV, Loaded, Notice, Page, Tabs, Timeline, useAction, useLoad } from '../shared/ui';
import { Stat, Table } from './common';

const TONE: Record<string, string> = { aberta: 'warn', aguarda_provas: 'warn', em_analise: 'info', resolvida: 'ok', escalada: 'bad' };
const PRIO_TONE: Record<string, string> = { urgente: 'bad', alta: 'warn', normal: 'info', baixa: 'muted' };
const SEV_TONE: Record<string, string> = { alta: 'bad', media: 'warn', baixa: 'muted' };
const RULES: Record<string, string> = {
  OTP_FALHADO: 'Várias tentativas erradas do código de entrega',
  CODIGO_RECOLHA_FALHADO: 'Várias tentativas erradas do código de recolha',
  LACRE_DIVERGENTE: 'Lacre diferente na entrega',
  RECOLHA_SUSPENSA: 'Recolha suspensa',
  PESO_DIVERGENTE: 'Peso muito diferente do declarado',
  CANCELAMENTO_POS_ATRIBUICAO: 'Muitos cancelamentos depois da atribuição',
  CODIGO_PAGAMENTO_REPETIDO: 'Código de pagamento já usado',
};

/** Centro de ocorrências: indicadores, lista com filtros e sinais de risco (LevaGo Safe). */
export function SecurityCenter() {
  const { api } = useSession();
  const [tab, setTab] = useState<'ocorrencias' | 'sinais'>('ocorrencias');
  const [status, setStatus] = useState('');
  const [qtext, setQtext] = useState('');
  const [riskStatus, setRiskStatus] = useState('pendente');
  const summary = useLoad(() => api.get<any>('/admin/security/summary'), []);
  const list = useLoad(() => api.get<any>(`/admin/security/incidents?${new URLSearchParams({ ...(status ? { status } : {}), ...(qtext ? { q: qtext } : {}) })}`), [status, qtext]);
  const risks = useLoad(() => (tab === 'sinais' ? api.get<any[]>(`/admin/security/risk-signals?status=${riskStatus}`) : Promise.resolve([])), [tab, riskStatus]);
  const a = useAction();
  return (
    <Page title="Segurança e ocorrências" wide>
      <Loaded q={summary}>
        {(s) => (
          <div className="stats">
            <Stat label="Abertas" value={s.by_status.filter((x: any) => x.status !== 'resolvida').reduce((n: number, x: any) => n + x.n, 0)} tone="warn" />
            <Stat label="Por 100 entregas (30 dias)" value={s.incidents_per_100_deliveries ?? '—'} />
            <Stat label="Tempo médio de resolução" value={s.avg_resolution_hours != null ? `${s.avg_resolution_hours} h` : '—'} />
            <Stat label="Recolhas suspensas" value={s.blocked_pickups} tone={s.blocked_pickups ? 'warn' : undefined} />
            <Stat label="Lacres divergentes" value={s.seal_anomalies} tone={s.seal_anomalies ? 'bad' : undefined} />
            <Stat label="Sinais por rever" value={s.pending_risk_signals} tone={s.pending_risk_signals ? 'warn' : undefined} />
          </div>
        )}
      </Loaded>
      <Tabs value={tab} onChange={setTab} options={[['ocorrencias', 'Ocorrências'], ['sinais', 'Sinais de risco']]} />
      {tab === 'ocorrencias' && (
        <div className="stack">
          <div className="filters">
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Todas</option>
              <option value="aberta">Abertas</option>
              <option value="aguarda_provas">Aguardam provas</option>
              <option value="em_analise">Em análise</option>
              <option value="escalada">Escaladas</option>
              <option value="resolvida">Resolvidas</option>
            </select>
            <input placeholder="Protocolo ou código da encomenda" value={qtext} onChange={(e) => setQtext(e.target.value.trim())} />
          </div>
          <Loaded q={list}>
            {(d) => (
              <Table
                head={['Protocolo', 'Prioridade', 'Tipo', 'Encomenda', 'Cliente', 'Estafeta', 'Estado', 'Data']}
                rows={d.items.map((i: any) => [
                  <Link key="p" to={`/admin/seguranca/${i.id}`}>{i.protocol}</Link>,
                  <Badge key="pr" tone={PRIO_TONE[i.priority]}>{lbl(i.priority)}</Badge>,
                  i.category_label, i.order_code, i.customer, i.courier ?? '—',
                  <Badge key="s" tone={TONE[i.status]}>{i.status_label}</Badge>, dateTime(i.created_at),
                ])}
                empty="Sem ocorrências."
              />
            )}
          </Loaded>
        </div>
      )}
      {tab === 'sinais' && (
        <div className="stack">
          <Notice>Os sinais servem só para triagem. Não provam culpa. Reveja cada um e escreva a conclusão.</Notice>
          <div className="filters">
            <select value={riskStatus} onChange={(e) => setRiskStatus(e.target.value)}>
              <option value="pendente">Por rever</option>
              <option value="confirmado">Confirmados</option>
              <option value="descartado">Descartados</option>
              <option value="todos">Todos</option>
            </select>
          </div>
          <ErrorBox error={a.error} />
          <Loaded q={risks}>
            {(rows) => (
              <Table
                head={['Sinal', 'Gravidade', 'Sobre', 'Encomenda', 'Factos', 'Estado', 'Data', '']}
                rows={rows.map((r: any) => [
                  RULES[r.rule_code] ?? r.rule_code, <Badge key="g" tone={SEV_TONE[r.severity]}>{r.severity}</Badge>,
                  `${r.subject_type === 'courier' ? 'Estafeta' : r.subject_type === 'customer' ? 'Cliente' : 'Encomenda'}${r.subject_name ? `: ${r.subject_name}` : ''}`,
                  r.order_code ?? '—', r.evidence ? JSON.stringify(r.evidence) : '—', r.review_status + (r.reviewer ? ` (${r.reviewer})` : ''), dateTime(r.created_at),
                  r.review_status === 'pendente' ? (
                    <span className="row-end">
                      {(['confirmado', 'descartado'] as const).map((st) => (
                        <button
                          key={st}
                          className={`link ${st === 'confirmado' ? 'danger' : ''}`}
                          onClick={async () => {
                            const note = window.prompt(st === 'confirmado' ? 'Porque confirma este sinal?' : 'Porque descarta este sinal?');
                            if (note && note.trim().length >= 3 && (await a.run(() => api.post(`/admin/security/risk-signals/${r.id}/review`, { status: st, note: note.trim() })))) risks.reload();
                          }}
                        >
                          {st === 'confirmado' ? 'Confirmar' : 'Descartar'}
                        </button>
                      ))}
                    </span>
                  ) : r.review_note ?? '',
                ])}
                empty="Sem sinais."
              />
            )}
          </Loaded>
        </div>
      )}
    </Page>
  );
}

/** Mostra uma foto de prova (carregada com a sessão do Admin; cada visualização fica na auditoria). */
function EvidencePhoto({ id, sha }: { id: string; sha: string }) {
  const { api } = useSession();
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  if (url) return <img src={url} alt="Prova" className="evidence-img" style={{ maxWidth: '100%', borderRadius: 8 }} />;
  return (
    <span>
      <button
        className="link"
        onClick={async () => {
          try {
            const res = await api.raw(`/admin/security/evidence/${id}`);
            setUrl(URL.createObjectURL(await res.blob()));
          } catch {
            setErr(true);
          }
        }}
      >
        Ver foto
      </button>{' '}
      <small className="mono" title={sha}>SHA-256 {sha.slice(0, 12)}…</small>
      {err && <small> (erro ao abrir)</small>}
    </span>
  );
}

const ACTIONS: [string, string][] = [
  ['nota_interna', 'Nota interna'],
  ['pedir_esclarecimento', 'Pedir esclarecimento ao cliente'],
  ['em_analise', 'Passar a em análise'],
  ['escalar', 'Escalar'],
  ['resolver', 'Resolver com decisão'],
  ['reabrir', 'Reabrir'],
  ['atribuir', 'Assumir esta ocorrência'],
  ['prioridade', 'Mudar prioridade'],
];

/** Dossiê da ocorrência: encomenda, declaração, custódia, inspecções, provas, mensagens e acções. */
export function IncidentDossier() {
  const { id } = useParams();
  const { api } = useSession();
  const q = useLoad(() => api.get<any>(`/admin/security/incidents/${id}`), [id]);
  const [action, setAction] = useState('nota_interna');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState('alta');
  const a = useAction();
  return (
    <Page title="Dossiê da ocorrência" back="/admin/seguranca" wide>
      <Loaded q={q}>
        {(i) => (
          <div className="grid-2">
            <div className="stack">
              <Card>
                <div className="row-between">
                  <h3>{i.protocol}</h3>
                  <Badge tone={TONE[i.status]}>{i.status_label}</Badge>
                </div>
                <KV
                  items={[
                    ['Tipo', i.category_label],
                    ['Prioridade', lbl(i.priority)],
                    ['Reportado por', `${i.reporter ?? '—'} (${lbl(i.reporter_role)})`],
                    ['Responsável', i.assignee ?? 'Ninguém'],
                    ['Descrição', i.description],
                    ['Aberta em', dateTime(i.created_at)],
                    ...(i.resolution ? ([['Decisão', i.resolution]] as [string, string][]) : []),
                  ]}
                />
              </Card>
              {i.order && (
                <Card>
                  <h3>
                    Encomenda <Link to={`/admin/encomendas/${i.order.id}`}>{i.order.code}</Link>
                  </h3>
                  <KV
                    items={[
                      ['Estado', i.order.status_label],
                      ['Cliente', i.order.customer],
                      ['Estafeta', i.order.courier ?? '—'],
                      ['Conteúdo declarado', `${i.order.description} (${i.order.category})`],
                      ['Volumes', `${i.order.quantity}${i.order.fragile ? ' · frágil' : ''}`],
                      ['Peso declarado', `${i.order.weight_kg} kg`],
                      ['Valor declarado', i.order.declared_value_cents != null ? mt(i.order.declared_value_cents) : '—'],
                      ['Declaração aceite', i.order.declaration_accepted_at ? `${dateTime(i.order.declaration_accepted_at)} (${i.order.declaration_version})` : 'Não'],
                      ['Lacre registado', i.order.seal_code ?? '—'],
                      ['Código de entrega', i.order.otp.validated ? `Validado em ${dateTime(i.order.otp.validated_at)}` : 'Não validado'],
                      ['Tentativas erradas (entrega / recolha)', `${i.order.otp.failed_attempts} / ${i.order.pickup_code_attempts}`],
                      ['Destinatário', `${i.order.recipient_name} (${i.order.recipient_phone})`],
                    ]}
                  />
                </Card>
              )}
              <Card>
                <h3>Cadeia de custódia</h3>
                <Table head={['Evento', 'De', 'Para', 'Método', 'Quem', 'Data']} rows={i.custody.map((c: any) => [c.label, c.from_party, c.to_party, c.method ?? '—', c.actor ?? '—', dateTime(c.occurred_at)])} empty="Sem eventos." />
              </Card>
              <Card>
                <h3>Inspecções</h3>
                <Table
                  head={['Momento', 'Embalagem', 'Corresponde', 'Destinatário', 'Peso', 'Lacre', 'Resultado', 'Quem', 'Data']}
                  rows={i.inspections.map((x: any) => [x.stage === 'pickup' ? 'Recolha' : 'Entrega', x.packaging_condition, x.external_match ?? '—', x.recipient_verdict ?? '—', x.measured_weight_kg ?? '—', x.seal_code ?? '—', x.outcome, x.inspector, dateTime(x.created_at)])}
                  empty="Sem inspecções."
                />
              </Card>
              <Card>
                <h3>Provas</h3>
                <Table
                  head={['Momento', 'Enviada por', 'Data', 'Ficheiro']}
                  rows={i.evidence.map((e: any) => [e.stage === 'pickup' ? 'Recolha' : e.stage === 'dropoff' ? 'Entrega' : 'Ocorrência', e.uploaded_by, dateTime(e.created_at), <EvidencePhoto key={e.id} id={e.id} sha={e.sha256} />])}
                  empty="Sem fotografias."
                />
              </Card>
            </div>
            <div className="stack">
              <Card className="stack">
                <h3>Acção</h3>
                <Field label="O que quer fazer?">
                  <select value={action} onChange={(e) => setAction(e.target.value)}>
                    {ACTIONS.filter(([k]) => (i.status === 'resolvida' ? ['reabrir', 'nota_interna'].includes(k) : k !== 'reabrir')).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                </Field>
                {action === 'prioridade' && (
                  <Field label="Nova prioridade">
                    <select value={priority} onChange={(e) => setPriority(e.target.value)}>
                      {['baixa', 'normal', 'alta', 'urgente'].map((p) => (
                        <option key={p} value={p}>
                          {lbl(p)}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                <Field label={action === 'pedir_esclarecimento' || action === 'resolver' ? 'Texto para o cliente' : 'Motivo ou nota (fica na auditoria)'}>
                  <textarea rows={3} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} />
                </Field>
                {action === 'resolver' && <Notice tone="warn">A decisão vai para o cliente. Escreva os factos que viu nas provas.</Notice>}
                <ErrorBox error={a.error} />
                <Button
                  busy={a.busy}
                  disabled={body.trim().length < 3}
                  onClick={async () => {
                    if (await a.run(() => api.post(`/admin/security/incidents/${i.id}/action`, { action, body: body.trim(), ...(action === 'prioridade' ? { priority } : {}) }))) {
                      setBody('');
                      q.reload();
                    }
                  }}
                >
                  Registar
                </Button>
              </Card>
              <Card className="stack">
                <h3>Mensagens e notas</h3>
                {i.notes.length === 0 && <small>Sem mensagens.</small>}
                {i.notes.map((n: any, k: number) => (
                  <div key={k} className="note">
                    <small>
                      {n.author ?? lbl(n.author_role)} · {n.kind.replace(/_/g, ' ')} {n.internal && <Badge>interna</Badge>} · {dateTime(n.created_at)}
                    </small>
                    <p>{n.body}</p>
                  </div>
                ))}
              </Card>
              <Card>
                <h3>Linha temporal da encomenda</h3>
                <Timeline events={i.events} />
              </Card>
              {i.risks.length > 0 && (
                <Card>
                  <h3>Sinais de risco</h3>
                  <Table head={['Sinal', 'Gravidade', 'Estado']} rows={i.risks.map((r: any) => [RULES[r.rule_code] ?? r.rule_code, r.severity, r.review_status])} />
                </Card>
              )}
              {i.related.length > 0 && (
                <Card>
                  <h3>Outras ocorrências da encomenda</h3>
                  {i.related.map((r: any) => (
                    <div key={r.id}>
                      <Link to={`/admin/seguranca/${r.id}`}>{r.protocol}</Link> <small>{r.category} · {r.status}</small>
                    </div>
                  ))}
                </Card>
              )}
            </div>
          </div>
        )}
      </Loaded>
    </Page>
  );
}
