import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PushCard } from '../shared/Alerts';
import { Icon, Logo, LogoMark } from '../shared/brand';
import { useConfig } from '../shared/config';
import { dateTime, HEADLINE, mt, SERVICE, WEEKDAYS } from '../shared/format';
import { MapView } from '../shared/map';
import { useSession } from '../shared/session';
import {
  Button, ButtonLink, Card, Confirm, Empty, ErrorBox, Field, KV, Loaded, Notice, OrderCard, OrderProgress, Page, Sheet, Tabs, useAction, useLoad,
} from '../shared/ui';

// ------------------------------------------------------------------ Boas-vindas
export function Welcome() {
  const cfg = useConfig();
  return (
    <div className="welcome-hero">
      <div className="welcome-top">
        <Logo size={46} light slogan />
      </div>
      <div className="welcome-bottom">
        <h2>Envie encomendas em Quelimane</h2>
        <ul className="bullets">
          <li>De bicicleta ou motorizada, até 15 kg e 15 km por estrada.</li>
          <li>Veja o preço antes de confirmar e acompanhe o estafeta no mapa.</li>
        </ul>
        {cfg && (
          <p className="small">
            Horário: {cfg.hours.map((h) => `${WEEKDAYS[h.weekday]!.slice(0, 3)} ${h.opens_at}-${h.closes_at}`).join(' · ')}
          </p>
        )}
        <ButtonLink to="/cliente/registo">Criar conta</ButtonLink>
        <ButtonLink to="/cliente/entrar" kind="outline">
          Entrar
        </ButtonLink>
        <p className="small center">
          <Icon name="pin" size={16} /> Quelimane, Moçambique · <Link to="/">Mudar de área</Link>
        </p>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Início
export function Home() {
  const { api } = useSession();
  const nav = useNavigate();
  const cfg = useConfig();
  const q = useLoad(() => api.get('/home'), [], 20_000);
  const orders = useLoad(() => api.get('/orders?filter=todas&page=1'), [], 30_000);
  const places = useLoad(() => api.get<any[]>('/addresses'), []);
  const [me, setMe] = useState<{ lat: number; lon: number } | null>(null);
  const [geoMsg, setGeoMsg] = useState<string | null>(null);

  const locate = () => {
    if (!navigator.geolocation) return setGeoMsg('Este dispositivo não indica a localização.');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setGeoMsg(null);
        setMe({ lat: p.coords.latitude, lon: p.coords.longitude });
      },
      () => setGeoMsg('Não foi possível obter a localização. Autorize o acesso no navegador.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const items: any[] = orders.data?.items ?? [];
  const last = items[0];

  return (
    <div className="map-screen">
      <MapView height="58vh" markers={me ? [{ ...me, kind: 'me' }] : []} padBottom={120} />
      <div className="map-top">
        <span className="round-btn" aria-hidden="true">
          <LogoMark size={28} />
        </span>
        <div className="row-end">
          <button type="button" className="round-btn" aria-label="Mostrar a minha localização" onClick={locate}>
            <Icon name="target" />
          </button>
          <Link to="/cliente/notificacoes" className="round-btn" aria-label="Notificações">
            <Icon name="bell" />
            {(q.data?.unread_notifications ?? 0) > 0 && <span className="dot-badge" />}
          </Link>
        </div>
      </div>
      <Sheet>
        <Loaded q={q}>
          {(h) => (
            <>
              <div className="stack" style={{ gap: '0.2rem' }}>
                <small className="sub">Olá, {String(h.name).split(' ')[0]}</small>
                <h2 className="headline">Que encomenda vai enviar?</h2>
              </div>
              {geoMsg && <Notice tone="warn">{geoMsg}</Notice>}
              {cfg && !cfg.open_now && <Notice tone="warn">Estamos fora do horário. Pode agendar uma entrega.</Notice>}
              <Link to="/cliente/nova" className="action-big">
                <Icon name="plus" size={24} /> Nova encomenda
              </Link>

              {(places.data ?? []).length > 0 && (
                <div className="place-list">
                  {places.data!.slice(0, 3).map((p) => (
                    <Link key={p.id} to={`/cliente/nova?para=${p.id}`} className="place-row">
                      <span className="ico">
                        <Icon name="pin" size={18} />
                      </span>
                      <span className="txt">
                        <strong>{p.label}</strong>
                        <small>{p.description}</small>
                      </span>
                      <Icon name="chevron" size={18} />
                    </Link>
                  ))}
                </div>
              )}

              {h.active_order && (
                <Link to={`/cliente/encomendas/${h.active_order.id}`} className="live-card">
                  <span className="icon-wrap">
                    <Icon name="scooter" />
                  </span>
                  <span className="txt">
                    <strong>{HEADLINE[h.active_order.status] ?? h.active_order.status}</strong>
                    <small>Encomenda {h.active_order.code}</small>
                    <OrderProgress status={h.active_order.status} labels={false} />
                  </span>
                  <Icon name="chevron" size={18} />
                </Link>
              )}

              {last && last.id !== h.active_order?.id && (
                <>
                  <h3>Última encomenda</h3>
                  <OrderCard o={last} onClick={() => nav(`/cliente/encomendas/${last.id}`)} />
                  {last.status === 'ENTREGUE' && !last.rated && (
                    <Link to={`/cliente/encomendas/${last.id}`} className="live-card">
                      <span className="icon-wrap">
                        <Icon name="star" />
                      </span>
                      <span className="txt">
                        <strong>Avalie o estafeta</strong>
                        <small>Diga como correu a entrega {last.code}.</small>
                      </span>
                      <Icon name="chevron" size={18} />
                    </Link>
                  )}
                </>
              )}

              <PushCard compact />

              {h.subscription ? (
                <Card>
                  <small>Subscrição {h.subscription.plan_name}</small>
                  <p>
                    <strong>{h.subscription.remaining}</strong> de {h.subscription.total} entregas disponíveis até {dateTime(h.subscription.period_end)}
                  </p>
                </Card>
              ) : (
                <Link to="/cliente/planos" className="live-card">
                  <span className="icon-wrap">
                    <Icon name="tag" />
                  </span>
                  <span className="txt">
                    <strong>Envia com frequência?</strong>
                    <small>Veja os planos de subscrição.</small>
                  </span>
                  <Icon name="chevron" size={18} />
                </Link>
              )}
            </>
          )}
        </Loaded>
      </Sheet>
    </div>
  );
}

// ------------------------------------------------------------------ Minhas encomendas
type Filter = 'todas' | 'em_curso' | 'concluidas' | 'canceladas';
export function Orders() {
  const { api } = useSession();
  const nav = useNavigate();
  const [filter, setFilter] = useState<Filter>('todas');
  const [page, setPage] = useState(1);
  const q = useLoad(() => api.get(`/orders?filter=${filter}&page=${page}`), [filter, page]);
  return (
    <Page title="Minhas encomendas">
      <Tabs
        value={filter}
        onChange={(f) => {
          setFilter(f);
          setPage(1);
        }}
        options={[['todas', 'Todas'], ['em_curso', 'Em curso'], ['concluidas', 'Concluídas'], ['canceladas', 'Canceladas']]}
      />
      <Loaded q={q}>
        {(d) =>
          d.items.length === 0 ? (
            <Empty icon="box" title="Sem encomendas" text="Quando enviar uma encomenda, ela aparece aqui." action={<ButtonLink to="/cliente/nova">Enviar encomenda</ButtonLink>} />
          ) : (
            <div className="stack">
              {d.items.map((o: any) => (
                <OrderCard key={o.id} o={o} onClick={() => nav(`/cliente/encomendas/${o.id}`)} />
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
                <h3>A sua subscrição: {d.active.plan_name}</h3>
                <KV
                  items={[
                    ['Entregas usadas', `${d.active.used} de ${d.active.total}`],
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
            {d.plans.length === 0 && <Empty icon="tag" title="Sem planos publicados" text="Os planos de subscrição ainda não estão disponíveis." />}
            {d.plans.map((p: any) => (
              <Card key={p.id} className="stack">
                <div className="row-between">
                  <h3>{p.name}</h3>
                  <strong>{mt(p.price_cents)}</strong>
                </div>
                {p.description && <p className="small">{p.description}</p>}
                <KV
                  items={[
                    ['Entregas incluídas', p.deliveries_included],
                    ['Período', `${p.period_days} dias`],
                    ['Modalidades', p.service_types.map((s: string) => SERVICE[s]).join(', ')],
                    ['Peso máximo por entrega', `${p.max_weight_kg} kg`],
                  ]}
                />
                {!d.active && (
                  <Button
                    busy={a.busy}
                    onClick={async () => {
                      const s = await a.run(() => api.post<{ id: string }>('/subscriptions', { plan_id: p.id }));
                      if (s) nav(`/cliente/pagar-plano/${s.id}`);
                    }}
                  >
                    Subscrever
                  </Button>
                )}
              </Card>
            ))}
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
            <Empty icon="bell" title="Sem notificações" text="Os avisos sobre as suas encomendas aparecem aqui." />
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
        <PushCard />
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
            <select value={f.theme} onChange={(e) => setF({ ...f, theme: e.target.value as typeof f.theme })}>
              <option value="system">Automático</option>
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
