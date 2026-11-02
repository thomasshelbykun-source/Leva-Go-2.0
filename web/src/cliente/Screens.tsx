import { HeroSheet } from '../shared/Hero';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Avatar, Icon, Logo } from '../shared/brand';
import { useConfig } from '../shared/config';
import { dateTime, mt, SERVICE, WEEKDAYS } from '../shared/format';
import { useSession } from '../shared/session';
import {
  Button, ButtonLink, Card, Confirm, Empty, ErrorBox, Field, KV, Loaded, Notice, Page, StatusBadge, Tabs, useAction, useLoad,
} from '../shared/ui';

// ------------------------------------------------------------------ Boas-vindas
export function Welcome() {
  const cfg = useConfig();
  return (
    <HeroSheet img="cliente">
      <div className="hs-head">
        <h1 className="hs-title">A tua encomenda, entregue hoje.</h1>
        <p className="hs-sub">Em toda a cidade de Quelimane, até 15 kg.</p>
      </div>
      <ul className="ticks">
        <li>Planos com encomendas incluídas</li>
        <li>Acompanha a entrega em tempo real</li>
        <li>Paga com M-Pesa ou e-Mola</li>
      </ul>
      {cfg && (
        <p className="small">
          Horário: {cfg.hours.map((h) => `${WEEKDAYS[h.weekday]!.slice(0, 3)} ${h.opens_at}-${h.closes_at}`).join(' · ')}
        </p>
      )}
      <ButtonLink to="/cliente/registo">Criar conta</ButtonLink>
      <ButtonLink to="/cliente/entrar" kind="secondary">
        Já tenho conta
      </ButtonLink>
      <p className="small center">
        <Icon name="pin" size={16} /> Quelimane, Moçambique · <Link to="/">Mudar de área</Link>
      </p>
    </HeroSheet>
  );
}

// ------------------------------------------------------------------ Início
/** Cliente novo ou sem saldo vê os planos. Cliente com plano vê o saldo e as 3 acções principais. */
export function Home() {
  const { api } = useSession();
  const cfg = useConfig();
  const q = useLoad(() => api.get('/home'), [], 20_000);
  return (
    <Page title="Início">
      <Loaded q={q}>
        {(h) => (
          <div className="stack">
            <div className="greet">
              <Avatar name={h.name} />
              <div>
                <h2>Olá, {String(h.name).split(' ')[0]}!</h2>
                <small>O que desejas fazer hoje?</small>
              </div>
            </div>
            {cfg && !cfg.open_now && <Notice tone="warn">Estamos fora do horário. Podes agendar uma entrega.</Notice>}
            {h.active_order && (
              <Card onClick={() => (location.href = `/cliente/encomendas/${h.active_order.id}`)}>
                <small>Encomenda em curso</small>
                <div className="row-between">
                  <strong>{h.active_order.code}</strong>
                  <StatusBadge status={h.active_order.status} />
                </div>
              </Card>
            )}
            {h.needs_plan ? <HomeNoPlan h={h} /> : <HomeWithPlan h={h} />}
          </div>
        )}
      </Loaded>
    </Page>
  );
}

function HomeWithPlan({ h }: { h: any }) {
  const s = h.subscription;
  const pct = Math.round((s.remaining / Math.max(1, s.total)) * 100);
  return (
    <>
      <div className="plan-balance">
        <div className="row-between">
          <span>Plano {s.plan_name}</span>
          <span className="pill-ok">Activo</span>
        </div>
        <div className="plan-count">
          <strong>{s.remaining}</strong> de {s.total} encomendas disponíveis
        </div>
        <div className="plan-bar">
          <span style={{ width: `${pct}%` }} />
        </div>
        <small>Válido até {dateTime(s.period_end).split(',')[0]}</small>
        {h.express_credits > 0 && <small className="credit">Tens {h.express_credits} crédito(s) expresso(s).</small>}
      </div>
      <Link to="/cliente/nova" className="action-big">
        <Icon name="box" size={26} /> Enviar encomenda
      </Link>
      <Link to="/cliente/nova?tipo=recolha" className="action-big action-navy">
        <Icon name="scooter" size={26} /> Pedir recolha
        <small>Restaurante, farmácia, loja ou mercado</small>
      </Link>
      <Link to={h.active_order ? `/cliente/encomendas/${h.active_order.id}` : '/cliente/encomendas'} className="action-big action-light">
        <Icon name="search" size={24} /> Acompanhar entrega
      </Link>
      <div className="grid-2">
        <Link to="/cliente/encomendas" className="tile">
          <Icon name="list" /> Histórico
        </Link>
        <Link to="/cliente/planos" className="tile">
          <Icon name="tag" /> Meu plano
        </Link>
      </div>
    </>
  );
}

function HomeNoPlan({ h }: { h: any }) {
  const ended = !!h.subscription;
  return (
    <>
      {ended ? (
        <Notice tone="warn">
          O teu plano {h.subscription.plan_name} já não tem encomendas disponíveis. Escolhe um plano para continuar a enviar sem pagar cada entrega.
        </Notice>
      ) : (
        <div className="promo">
          <strong>Envia mais, paga menos.</strong>
          <small>Escolhe um plano e envia encomendas Normais sem pagar cada entrega.</small>
        </div>
      )}
      <PlanGrid plans={h.plans} recommended={h.recommended_plan_id} supplement={h.express_supplement_cents} />
      <Link to="/cliente/nova" className="action-big action-light">
        <Icon name="box" size={24} /> Enviar sem plano (pagar por entrega)
      </Link>
      <div className="grid-2">
        <Link to="/cliente/encomendas" className="tile">
          <Icon name="search" /> Acompanhar entrega
        </Link>
        <Link to="/cliente/apoio" className="tile">
          <Icon name="chat" /> Ajuda e suporte
        </Link>
      </div>
    </>
  );
}

/** Grelha de planos publicada pelo Admin. «Contratar» cria a subscrição e abre o pagamento. */
export function PlanGrid({ plans, recommended, supplement }: { plans: any[]; recommended?: string; supplement?: number }) {
  const { api } = useSession();
  const nav = useNavigate();
  const a = useAction();
  if (!plans?.length) return <Empty title="Sem planos publicados" text="Os planos ainda não estão disponíveis." />;
  return (
    <div className="stack">
      <h3>Planos de subscrição</h3>
      <div className="plan-grid">
        {plans.map((p) => (
          <div key={p.id} className={`plan-card ${p.id === recommended ? 'recommended' : ''}`}>
            {p.id === recommended && <span className="plan-flag">Recomendado</span>}
            <strong className="plan-name">{p.name}</strong>
            <div className="plan-price">{mt(p.price_cents)}</div>
            <div className="plan-qty">{p.deliveries_included} encomendas</div>
            <small>Válido {p.period_days} dias</small>
            <Button
              kind={p.id === recommended ? 'primary' : 'secondary'}
              busy={a.busy}
              onClick={async () => {
                const s = await a.run(() => api.post<{ id: string }>('/subscriptions', { plan_id: p.id }));
                if (s) nav(`/cliente/pagar-plano/${s.id}`);
              }}
            >
              Contratar
            </Button>
          </div>
        ))}
      </div>
      <small className="center">Normal: sem custo adicional. Expressa: +{mt(supplement ?? 15000)} por encomenda.</small>
      <ErrorBox error={a.error} />
    </div>
  );
}

// ------------------------------------------------------------------ Minhas encomendas
type Filter = 'todas' | 'recolhas' | 'envios' | 'em_curso' | 'concluidas' | 'canceladas';
export function Orders() {
  const { api } = useSession();
  const nav = useNavigate();
  const [filter, setFilter] = useState<Filter>('todas');
  const [page, setPage] = useState(1);
  const q = useLoad(() => api.get(`/orders?filter=${filter}&page=${page}`), [filter, page]);
  return (
    <Page title="Histórico">
      <Tabs
        value={filter}
        onChange={(f) => {
          setFilter(f);
          setPage(1);
        }}
        options={[['todas', 'Todas'], ['recolhas', 'Recolhas'], ['envios', 'Envios'], ['em_curso', 'Em curso'], ['concluidas', 'Concluídas']]}
      />
      <Loaded q={q}>
        {(d) =>
          d.items.length === 0 ? (
            <Empty title="Sem encomendas" text="Quando enviar uma encomenda, ela aparece aqui." action={<ButtonLink to="/cliente/nova">Enviar encomenda</ButtonLink>} />
          ) : (
            <div className="stack">
              {d.items.map((o: any) => (
                <Card key={o.id} onClick={() => nav(`/cliente/encomendas/${o.id}`)}>
                  <div className="row-between">
                    <strong>{o.code}</strong>
                    <StatusBadge status={o.status} label={o.status_label} />
                  </div>
                  <small className="ellipsis">{o.order_kind === 'recolha' ? 'Recolha' : 'Envio'} → {o.dropoff?.text}</small>
                  <div className="row-between small">
                    <span>{dateTime(o.created_at)}</span>
                    <span>{mt(o.price_cents)}</span>
                  </div>
                </Card>
              ))}
              <div className="row-between">
                <Button kind="ghost" disabled={page === 1} onClick={() => setPage(page - 1)}>
                  Anteriores
                </Button>
                <Button kind="ghost" disabled={d.items.length < 20} onClick={() => setPage(page + 1)}>
                  Seguintes
                </Button>
              </div>
            </div>
          )
        }
      </Loaded>
    </Page>
  );
}

// ------------------------------------------------------------------ Planos e subscrição
export function Plans() {
  const { api } = useSession();
  const nav = useNavigate();
  const q = useLoad(() => api.get('/plans'), []);
  const a = useAction();
  const [cancel, setCancel] = useState(false);
  return (
    <Page title="Planos" back="/cliente">
      <Loaded q={q}>
        {(d) => (
          <div className="stack">
            {d.active && (
              <Card>
                <h3>Plano {d.active.plan_name} {d.active.remaining > 0 ? '(activo)' : '(sem encomendas)'}</h3>
                <KV
                  items={[
                    ['Encomendas disponíveis', `${d.active.remaining} de ${d.active.total}`],
                    ['Válida até', dateTime(d.active.period_end)],
                    ['Modalidades', d.active.service_types.map((s: string) => SERVICE[s]).join(', ')],
                    ['Peso máximo', `${d.active.max_weight_kg} kg`],
                    ['Renovação automática', d.active.auto_renew ? 'Sim' : 'Não'],
                  ]}
                />
                {d.active.auto_renew && (
                  <Button kind="ghost" onClick={() => setCancel(true)}>
                    Cancelar renovação
                  </Button>
                )}
              </Card>
            )}
            {(!d.active || d.active.remaining <= 0) && <PlanGrid plans={d.plans} recommended="plano-plus" />}
            <ErrorBox error={a.error} />
            {cancel && (
              <Confirm
                title="Cancelar renovação?"
                text="As entregas do período já pago continuam disponíveis até ao fim."
                confirmLabel="Cancelar renovação"
                danger
                onClose={() => setCancel(false)}
                onConfirm={async () => {
                  await api.post(`/subscriptions/${d.active.id}/cancel`);
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

// ------------------------------------------------------------------ Notificações
export function Notifications({ base }: { base: string }) {
  const { api } = useSession();
  const nav = useNavigate();
  const q = useLoad(() => api.get<any[]>('/notifications'), []);
  return (
    <Page
      title="Notificações"
      actions={
        <Button kind="ghost" onClick={async () => (await api.post('/notifications/read')) && q.reload()}>
          Marcar todas como lidas
        </Button>
      }
    >
      <Loaded q={q}>
        {(items) =>
          items.length === 0 ? (
            <Empty title="Sem notificações" />
          ) : (
            <div className="stack">
              {items.map((n) => (
                <Card
                  key={n.id}
                  className={n.read_at ? '' : 'unread'}
                  onClick={async () => {
                    if (!n.read_at) await api.post('/notifications/read', { ids: [n.id] }).catch(() => null);
                    if (n.order_id) nav(`${base}/${base.endsWith('estafeta') ? 'tarefa' : 'encomendas'}/${n.order_id}`);
                    else void q.reload(true);
                  }}
                >
                  <div className="row-between">
                    <strong>{n.title}</strong>
                    <small>{dateTime(n.created_at)}</small>
                  </div>
                  <p>{n.body}</p>
                </Card>
              ))}
            </div>
          )
        }
      </Loaded>
    </Page>
  );
}

// ------------------------------------------------------------------ Perfil e definições
export function Profile({ base }: { base: string }) {
  const s = useSession();
  const nav = useNavigate();
  const me = s.me!;
  const [f, setF] = useState({ name: me.name, email: me.email ?? '', theme: me.theme, promos: !!me.notify_prefs?.promos });
  const save = useAction();
  const [saved, setSaved] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '' });
  const pwA = useAction();
  const [pwOk, setPwOk] = useState(false);
  const [del, setDel] = useState(false);
  const [delPw, setDelPw] = useState('');
  const addresses = useLoad(() => (s.app === 'cliente' ? s.api.get<any[]>('/addresses') : Promise.resolve([])), []);
  const [addr, setAddr] = useState<{ label: string } | null>(null);

  return (
    <Page title="Perfil e definições">
      <div className="stack">
        <Card className="stack">
          <h3>Dados pessoais</h3>
          <Field label="Nome">
            <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Telemóvel" hint="Para mudar o número, contacte o apoio.">
            <input value={me.phone} disabled />
          </Field>
          <Field label="Email">
            <input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </Field>
          <Field label="Tema">
            <select value={f.theme === 'dark' ? 'dark' : 'light'} onChange={(e) => setF({ ...f, theme: e.target.value as typeof f.theme })}>
              <option value="light">Claro</option>
              <option value="dark">Escuro</option>
            </select>
          </Field>
          <label className="check">
            <input type="checkbox" checked={f.promos} onChange={(e) => setF({ ...f, promos: e.target.checked })} /> Receber novidades e promoções
          </label>
          <small>Avisos sobre as suas encomendas são sempre enviados.</small>
          <ErrorBox error={save.error} />
          {saved && <Notice tone="ok">Alterações guardadas.</Notice>}
          <Button
            busy={save.busy}
            onClick={async () => {
              const ok = await save.run(() => s.api.patch('/profile', { name: f.name, email: f.email, theme: f.theme, notify_prefs: { promos: f.promos } }));
              if (ok) {
                setSaved(true);
                await s.refresh();
              }
            }}
          >
            Guardar
          </Button>
        </Card>

        {s.app === 'cliente' && (
          <Card className="stack">
            <h3>Moradas guardadas</h3>
            <Loaded q={addresses}>
              {(list) =>
                list.length === 0 ? (
                  <p className="small">Ainda não guardou moradas. Guarde a morada de uma encomenda já feita.</p>
                ) : (
                  <ul className="list">
                    {list.map((x) => (
                      <li key={x.id} className="row-between">
                        <span>
                          <strong>{x.label}</strong> <small>{x.description}</small>
                        </span>
                        <Button kind="ghost" onClick={async () => (await s.api.del(`/addresses/${x.id}`)) && addresses.reload()}>
                          Apagar
                        </Button>
                      </li>
                    ))}
                  </ul>
                )
              }
            </Loaded>
            <SaveRecentAddress onSaved={() => addresses.reload()} addr={addr} setAddr={setAddr} />
          </Card>
        )}

        <Card className="stack">
          <h3>Segurança</h3>
          <Field label="Palavra-passe actual">
            <input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          </Field>
          <Field label="Nova palavra-passe" hint="8 ou mais caracteres, com letras e números">
            <input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          </Field>
          <ErrorBox error={pwA.error} />
          {pwOk && <Notice tone="ok">Palavra-passe alterada. As outras sessões foram terminadas.</Notice>}
          <Button kind="secondary" busy={pwA.busy} disabled={!pw.current || !pw.next} onClick={async () => setPwOk(!!(await pwA.run(() => s.api.post('/profile/password', pw))))}>
            Alterar palavra-passe
          </Button>
          <Button kind="ghost" onClick={async () => { await s.signOut(true); nav(`${base}/entrar`); }}>
            Terminar sessão em todos os dispositivos
          </Button>
        </Card>

        <Card className="stack">
          <h3>Ajuda e informação</h3>
          <Link to={`${base}/apoio`}>Apoio ao cliente</Link>
          {base === '/cliente' && <Link to="/cliente/ocorrencias">As minhas ocorrências</Link>}
          <Link to="/termos">Termos de utilização</Link>
          <Link to="/privacidade">Política de privacidade</Link>
          <small>LevaGo versão 2.0.0</small>
        </Card>

        <Button kind="secondary" onClick={async () => { await s.signOut(); nav(base); }}>
          Sair
        </Button>
        <Button kind="ghost" onClick={() => setDel(true)}>
          Eliminar conta
        </Button>
        {del && (
          <Confirm
            title="Eliminar conta?"
            text="O pedido fica registado e os dados são apagados segundo os prazos legais de retenção. Encomendas em curso têm de terminar antes."
            danger
            confirmLabel="Eliminar conta"
            onClose={() => setDel(false)}
            onConfirm={async () => {
              await s.api.post('/account/delete', { password: delPw });
              await s.signOut();
              nav(base);
              return true;
            }}
          >
            <Field label="Confirme com a palavra-passe">
              <input type="password" value={delPw} onChange={(e) => setDelPw(e.target.value)} />
            </Field>
          </Confirm>
        )}
      </div>
    </Page>
  );
}

/** Guarda como morada o destino ou a recolha de uma encomenda recente. */
function SaveRecentAddress({ onSaved, addr, setAddr }: { onSaved: () => void; addr: { label: string } | null; setAddr: (a: { label: string } | null) => void }) {
  const { api } = useSession();
  const recent = useLoad(() => api.get('/orders?filter=todas&page=1'), []);
  const [pick, setPick] = useState('');
  const a = useAction();
  const places: { key: string; text: string; lat: number; lon: number }[] = [];
  for (const o of recent.data?.items ?? []) {
    for (const p of [o.pickup, o.dropoff]) if (p?.text && !places.some((x) => x.text === p.text)) places.push({ key: `${o.id}-${places.length}`, ...p });
  }
  if (!places.length) return null;
  if (!addr) return <Button kind="ghost" onClick={() => setAddr({ label: '' })}>Guardar uma morada recente</Button>;
  const chosen = places.find((p) => p.key === pick);
  return (
    <div className="stack">
      <Field label="Morada">
        <select value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">Escolha…</option>
          {places.map((p) => (
            <option key={p.key} value={p.key}>
              {p.text.slice(0, 80)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Nome (ex.: Casa, Trabalho)">
        <input value={addr.label} onChange={(e) => setAddr({ label: e.target.value })} maxLength={40} />
      </Field>
      <ErrorBox error={a.error} />
      <Button
        busy={a.busy}
        disabled={!chosen || !addr.label}
        onClick={async () => {
          const ok = await a.run(() => api.post('/addresses', { label: addr.label, description: chosen!.text, lat: chosen!.lat, lon: chosen!.lon }));
          if (ok) {
            setAddr(null);
            onSaved();
          }
        }}
      >
        Guardar morada
      </Button>
    </div>
  );
}

// ------------------------------------------------------------------ Apoio
export function Support({ base }: { base: string }) {
  const { api } = useSession();
  const [search] = useSearchParams();
  const [open, setOpen] = useState<string | null>(null);
  const [f, setF] = useState({ subject: '', message: '' });
  const list = useLoad(() => api.get<any[]>('/support'), []);
  const a = useAction();
  const orderId = search.get('encomenda');
  return (
    <Page title="Apoio" back={base}>
      <div className="stack">
        <Card className="stack">
          <h3>Novo pedido de ajuda</h3>
          {orderId && <Notice>Sobre a encomenda seleccionada.</Notice>}
          <Field label="Assunto">
            <input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} maxLength={120} />
          </Field>
          <Field label="Mensagem">
            <textarea rows={4} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />
          </Field>
          <ErrorBox error={a.error} />
          <Button
            busy={a.busy}
            disabled={f.subject.length < 3 || f.message.length < 3}
            onClick={async () => {
              const r = await a.run(() => api.post<{ id: string }>('/support', { ...f, order_id: orderId ?? undefined }));
              if (r) {
                setF({ subject: '', message: '' });
                setOpen(r.id);
                void list.reload();
              }
            }}
          >
            Enviar
          </Button>
        </Card>
        <Loaded q={list}>
          {(items) =>
            items.length === 0 ? null : (
              <div className="stack">
                <h3>Os meus pedidos</h3>
                {items.map((t) => (
                  <Card key={t.id} onClick={() => setOpen(open === t.id ? null : t.id)}>
                    <div className="row-between">
                      <strong>{t.subject}</strong>
                      <span className="badge badge-info">{t.status.replace('_', ' ')}</span>
                    </div>
                    <small>{dateTime(t.updated_at)}</small>
                    {open === t.id && <Ticket id={t.id} />}
                  </Card>
                ))}
              </div>
            )
          }
        </Loaded>
      </div>
    </Page>
  );
}

function Ticket({ id }: { id: string }) {
  const { api } = useSession();
  const q = useLoad(() => api.get(`/support/${id}`), [id]);
  const [body, setBody] = useState('');
  const a = useAction();
  return (
    <div className="stack" onClick={(e) => e.stopPropagation()}>
      <Loaded q={q}>
        {(t) => (
          <>
            <div className="chat">
              {t.messages.map((m: any) => (
                <div key={m.id} className={m.mine ? 'msg mine' : 'msg'}>
                  <p>{m.body}</p>
                  <small>{dateTime(m.created_at)}</small>
                </div>
              ))}
            </div>
            {t.status !== 'fechado' && (
              <>
                <textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Escreva uma resposta" />
                <ErrorBox error={a.error} />
                <Button busy={a.busy} disabled={!body.trim()} onClick={async () => (await a.run(() => api.post(`/support/${id}/messages`, { body }))) && (setBody(''), q.reload())}>
                  Responder
                </Button>
              </>
            )}
          </>
        )}
      </Loaded>
    </div>
  );
}
