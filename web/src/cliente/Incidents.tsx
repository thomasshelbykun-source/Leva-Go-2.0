import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { newIdempotencyKey } from '../shared/api';
import { dateTime } from '../shared/format';
import { useSession } from '../shared/session';
import { Badge, Button, Card, Empty, ErrorBox, Field, KV, Loaded, Notice, Page, useAction, useLoad } from '../shared/ui';

export const CUSTOMER_INCIDENTS: [string, string][] = [
  ['aberto_violado', 'Encomenda aberta ou violada'],
  ['danificado', 'Encomenda danificada'],
  ['conteudo_divergente', 'Conteúdo diferente'],
  ['nao_recebido', 'Não recebi a encomenda'],
  ['atraso', 'Atraso'],
  ['outro', 'Outro'],
];

const STATUS_TONE: Record<string, string> = { aberta: 'warn', aguarda_provas: 'warn', em_analise: 'info', resolvida: 'ok', escalada: 'bad' };

/** Fotografias de prova do cliente: até 6, enviadas uma a uma para a área privada. */
function PhotoPicker({ keys, onChange }: { keys: string[]; onChange: (k: string[]) => void }) {
  const { api } = useSession();
  const a = useAction();
  return (
    <Field label="Fotografias (opcional, até 6)" hint="As fotografias ficam privadas. Só a equipa LevaGo as vê.">
      <input
        type="file"
        accept="image/*"
        capture="environment"
        disabled={keys.length >= 6 || a.busy}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          const form = new FormData();
          form.append('file', f);
          const r = await a.run(() => api.upload<{ photo_key: string }>('/evidence/upload', form));
          if (r) onChange([...keys, r.photo_key]);
        }}
      />
      {keys.length > 0 && <small>{keys.length} fotografia(s) anexada(s).</small>}
      <ErrorBox error={a.error} />
    </Field>
  );
}

/** Formulário «Reportar problema» no ecrã da encomenda. */
export function ReportProblem({ orderId, onDone }: { orderId: string; onDone: () => void }) {
  const { api } = useSession();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState('aberto_violado');
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [idem, setIdem] = useState(newIdempotencyKey);
  const [done, setDone] = useState<string | null>(null);
  const a = useAction();
  if (done) return <Notice tone="ok">Ocorrência registada com o protocolo {done}. Vamos analisar e responder aqui.</Notice>;
  if (!open)
    return (
      <Button kind="secondary" onClick={() => setOpen(true)}>
        Reportar problema
      </Button>
    );
  return (
    <Card className="stack">
      <h3>Reportar problema</h3>
      <Field label="O que aconteceu?">
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {CUSTOMER_INCIDENTS.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Descreva o problema">
        <textarea rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <PhotoPicker keys={photos} onChange={setPhotos} />
      <ErrorBox error={a.error} />
      <div className="row-between">
        <Button kind="ghost" onClick={() => setOpen(false)}>
          Fechar
        </Button>
        <Button
          busy={a.busy}
          disabled={text.trim().length < 5}
          onClick={async () => {
            const r = await a.run(() => api.post<{ protocol: string }>(`/orders/${orderId}/incidents`, { category, description: text.trim(), photo_keys: photos }, idem));
            if (r) {
              setDone(r.protocol);
              setIdem(newIdempotencyKey());
              onDone();
            }
          }}
        >
          Enviar
        </Button>
      </div>
    </Card>
  );
}

/** Lista das ocorrências do cliente. */
export function MyIncidents() {
  const { api } = useSession();
  const q = useLoad(() => api.get<any[]>('/incidents'), []);
  return (
    <Page title="Ocorrências" back="/cliente/perfil">
      <Loaded q={q}>
        {(rows) =>
          rows.length === 0 ? (
            <Empty title="Sem ocorrências" text="Se algo correr mal com uma encomenda, use «Reportar problema» no ecrã da encomenda." />
          ) : (
            <div className="stack">
              {rows.map((r) => (
                <Link key={r.id} to={`/cliente/ocorrencias/${r.id}`} className="card">
                  <div className="row-between">
                    <strong>{r.protocol}</strong>
                    <Badge tone={STATUS_TONE[r.status]}>{r.status_label}</Badge>
                  </div>
                  <small>
                    {r.category_label} · Encomenda {r.order_code} · {dateTime(r.created_at)}
                  </small>
                </Link>
              ))}
            </div>
          )
        }
      </Loaded>
    </Page>
  );
}

const NOTE_LABEL: Record<string, string> = { mensagem: 'Mensagem', pedido_esclarecimento: 'Pedido de esclarecimento', decisao: 'Decisão', mudanca_estado: 'Actualização' };

/** Detalhe de uma ocorrência: mensagens da equipa, decisão e resposta do cliente. */
export function IncidentDetail() {
  const { id } = useParams();
  const { api } = useSession();
  const nav = useNavigate();
  const q = useLoad(() => api.get<any>(`/incidents/${id}`), [id]);
  const [reply, setReply] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const a = useAction();
  return (
    <Page title="Ocorrência" back="/cliente/ocorrencias">
      <Loaded q={q}>
        {(i) => (
          <div className="stack">
            <Card>
              <div className="row-between">
                <strong>{i.protocol}</strong>
                <Badge tone={STATUS_TONE[i.status]}>{i.status_label}</Badge>
              </div>
              <KV
                items={[
                  ['Encomenda', <a key="o" onClick={() => nav(`/cliente/encomendas/${i.order_id}`)}>{i.order_code}</a>],
                  ['Tipo', i.category_label],
                  ['Descrição', i.description],
                  ['Aberta em', dateTime(i.created_at)],
                  ['Fotografias enviadas', String(i.photos.length)],
                  ...(i.resolution ? ([['Decisão', i.resolution]] as [string, string][]) : []),
                ]}
              />
            </Card>
            {i.notes.length > 0 && (
              <Card className="stack">
                <h3>Mensagens</h3>
                {i.notes.map((n: any, k: number) => (
                  <div key={k} className={`note ${n.author_role === 'customer' ? 'mine' : ''}`}>
                    <small>
                      {n.author_role === 'customer' ? 'Você' : `Equipa LevaGo · ${NOTE_LABEL[n.kind] ?? n.kind}`} · {dateTime(n.created_at)}
                    </small>
                    <p>{n.body}</p>
                  </div>
                ))}
              </Card>
            )}
            {i.status !== 'resolvida' && (
              <Card className="stack">
                <Field label="Responder ou acrescentar informação">
                  <textarea rows={3} maxLength={1000} value={reply} onChange={(e) => setReply(e.target.value)} />
                </Field>
                <PhotoPicker keys={photos} onChange={setPhotos} />
                <ErrorBox error={a.error} />
                <Button
                  busy={a.busy}
                  disabled={reply.trim().length < 2}
                  onClick={async () => {
                    if (await a.run(() => api.post(`/incidents/${i.id}/reply`, { body: reply.trim(), photo_keys: photos }))) {
                      setReply('');
                      setPhotos([]);
                      q.reload();
                    }
                  }}
                >
                  Enviar resposta
                </Button>
              </Card>
            )}
          </div>
        )}
      </Loaded>
    </Page>
  );
}
