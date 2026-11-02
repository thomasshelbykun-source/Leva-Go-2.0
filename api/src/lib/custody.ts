// Protecção de encomendas, cadeia de custódia e LevaGo Safe (sinais de risco).
// Princípios: o estafeta faz só inspecção externa; «declarado» não é «verificado»; provas e eventos não se apagam;
// sinais de risco servem só para triagem humana e nunca presumem culpa.
import type { Db, Stmt } from './db.js';
import { all, bad, getSetting, one, uuid } from './core.js';
import { randomDigits } from './crypto.js';

export interface CustodySettings {
  pickup_code_required: boolean;
  pickup_photos_min: number;
  dropoff_photos_min: number;
  seal_required: boolean;
  declaration_version: string;
  max_declared_value_cents: number | null;
  otp_risk_threshold: number;
}

export const CUSTODY_DEFAULTS: CustodySettings = {
  pickup_code_required: true,
  pickup_photos_min: 1,
  dropoff_photos_min: 0,
  seal_required: false,
  declaration_version: 'declaracao-1',
  max_declared_value_cents: null,
  otp_risk_threshold: 3,
};

export const custodySettings = (db: Db) => getSetting(db, 'custody', CUSTODY_DEFAULTS);

export const PACKAGING = ['intacta', 'danificada', 'aberta', 'insegura'] as const;
export const EXTERNAL_MATCH = ['sim', 'nao', 'nao_verificavel'] as const;
export const MAX_PHOTOS = 6;

export const INCIDENT_CATEGORIES: Record<string, string> = {
  embalagem_aberta: 'Embalagem aberta ou violada',
  embalagem_danificada: 'Embalagem danificada',
  embalagem_insegura: 'Embalagem insegura',
  descricao_divergente: 'Conteúdo diferente do declarado',
  peso_acima_limite: 'Peso acima do limite',
  lacre_divergente: 'Lacre divergente ou rompido',
  anomalia_na_entrega: 'Anomalia na entrega',
  destinatario_ausente: 'Destinatário ausente',
  destinatario_recusa: 'Destinatário recusou',
  morada_errada: 'Morada errada',
  acidente: 'Acidente',
  seguranca: 'Segurança / emergência',
  aberto_violado: 'Encomenda aberta ou violada',
  danificado: 'Encomenda danificada',
  conteudo_divergente: 'Conteúdo diferente',
  nao_recebido: 'Não recebi a encomenda',
  atraso: 'Atraso',
  outro: 'Outro',
};

export const INCIDENT_STATUS_LABELS: Record<string, string> = {
  aberta: 'Aberta',
  aguarda_provas: 'Aguarda provas',
  em_analise: 'Em análise',
  resolvida: 'Resolvida',
  escalada: 'Escalada',
};

export const CUSTODY_LABELS: Record<string, string> = {
  recolha_confirmada: 'Recolha confirmada pelo remetente',
  recolha_suspensa: 'Recolha suspensa para verificação',
  entrega_confirmada: 'Entrega confirmada com o código',
  entrega_falhada: 'Tentativa de entrega sem sucesso',
  devolucao_confirmada: 'Encomenda devolvida',
  transferencia: 'Encomenda passou para outro estafeta',
  excepcao_autorizada: 'Decisão da equipa LevaGo',
};

export const newPickupCode = () => randomDigits(4);

export const protocolCode = () => `OC-${uuid().replace(/-/g, '').slice(0, 6).toUpperCase()}`;

/** Valida chaves de fotos: só do próprio utilizador, ainda não usadas como prova. */
export async function checkPhotoKeys(db: Db, keys: string[] | undefined, prefix: string, min: number) {
  const list = [...new Set(keys ?? [])];
  if (list.length > MAX_PHOTOS) throw bad('fotos', `No máximo ${MAX_PHOTOS} fotografias.`);
  if (list.length < min) throw bad('fotos', min === 1 ? 'Tire pelo menos 1 fotografia da embalagem.' : `Tire pelo menos ${min} fotografias da embalagem.`);
  for (const k of list) if (typeof k !== 'string' || !k.startsWith(prefix)) throw bad('fotos', 'Fotografia inválida.');
  if (list.length) {
    const found = await all<{ key: string; used: string | null }>(
      db,
      `SELECT b.key, e.id AS used FROM file_blobs b LEFT JOIN evidence_files e ON e.storage_key = b.key WHERE b.key IN (${list.map(() => '?').join(',')})`,
      ...list,
    );
    if (found.length !== list.length) throw bad('fotos', 'Uma fotografia não foi encontrada. Volte a enviá-la.');
    if (found.some((f) => f.used)) throw bad('fotos', 'Uma fotografia já foi usada noutra prova. Tire uma nova.');
  }
  return list;
}

/** Liga fotos a uma prova, com o SHA-256 calculado no servidor a partir do ficheiro guardado. */
export function evidenceStmts(
  db: Db,
  keys: string[],
  p: { orderId: string; stage: 'pickup' | 'dropoff' | 'incident'; uploadedBy: string; inspectionId?: string | null; incidentId?: string | null },
): Stmt[] {
  return keys.map((k) =>
    db
      .prepare(
        `INSERT INTO evidence_files (id, order_id, inspection_id, incident_id, storage_key, media_type, size_bytes, sha256, stage, uploaded_by)
         SELECT ?, ?, ?, ?, key, content_type, size_bytes, encode(sha256(data), 'hex'), ?, ? FROM file_blobs WHERE key = ?`,
      )
      .bind(uuid(), p.orderId, p.inspectionId ?? null, p.incidentId ?? null, p.stage, p.uploadedBy, k),
  );
}

export function inspectionStmt(
  db: Db,
  id: string,
  p: {
    orderId: string;
    stage: 'pickup' | 'dropoff';
    inspectorId: string;
    packaging: string;
    externalMatch?: string | null;
    recipientVerdict?: string | null;
    measuredWeightKg?: number | null;
    weightMethod?: string | null;
    sealCode?: string | null;
    notes?: string | null;
    outcome: 'aprovada' | 'bloqueada';
    requestKey?: string | null;
  },
) {
  return db
    .prepare(
      `INSERT INTO package_inspections (id, order_id, stage, inspector_id, packaging_condition, external_match, recipient_verdict, measured_weight_kg,
         weight_method, seal_code, notes, outcome, request_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id, p.orderId, p.stage, p.inspectorId, p.packaging, p.externalMatch ?? null, p.recipientVerdict ?? null, p.measuredWeightKg ?? null,
      p.weightMethod ?? null, p.sealCode ?? null, p.notes ?? null, p.outcome, p.requestKey ?? null,
    );
}

export function custodyStmt(
  db: Db,
  p: { orderId: string; type: string; from: string; to: string; actorId: string | null; method?: string | null; inspectionId?: string | null; metadata?: unknown },
) {
  return db
    .prepare('INSERT INTO custody_events (id, order_id, event_type, from_party, to_party, actor_id, method, inspection_id, metadata) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(uuid(), p.orderId, p.type, p.from, p.to, p.actorId, p.method ?? null, p.inspectionId ?? null, p.metadata === undefined ? null : JSON.stringify(p.metadata));
}

export function incidentStmt(
  db: Db,
  id: string,
  p: { orderId: string; reporterId: string | null; role: 'customer' | 'courier' | 'admin' | 'system'; category: string; description: string; priority?: string; requestKey?: string | null },
) {
  return db
    .prepare('INSERT INTO incidents (id, protocol, order_id, reporter_id, reporter_role, category, description, priority, request_key) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(id, protocolCode(), p.orderId, p.reporterId, p.role, p.category, p.description, p.priority ?? 'normal', p.requestKey ?? null);
}

/** Sinal de risco para triagem humana. O dedupe_key evita repetir o mesmo alerta. */
export function riskStmt(
  db: Db,
  p: { rule: string; severity: 'baixa' | 'media' | 'alta'; subjectType: 'order' | 'customer' | 'courier'; subjectId: string; orderId?: string | null; evidence?: unknown; dedupe: string },
) {
  return db
    .prepare(
      'INSERT INTO risk_signals (id, rule_code, severity, subject_type, subject_id, order_id, evidence, dedupe_key) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT (dedupe_key) DO NOTHING',
    )
    .bind(uuid(), p.rule, p.severity, p.subjectType, p.subjectId, p.orderId ?? null, p.evidence === undefined ? null : JSON.stringify(p.evidence), p.dedupe);
}

/** Linha temporal de custódia que o cliente pode ver: só factos, sem dados internos de outras pessoas. */
export async function customerCustody(db: Db, orderId: string) {
  const rows = await all<{ event_type: string; occurred_at: string; method: string | null }>(
    db,
    'SELECT event_type, occurred_at, method FROM custody_events WHERE order_id = ? ORDER BY occurred_at',
    orderId,
  );
  return rows.map((r) => ({ ...r, label: CUSTODY_LABELS[r.event_type] ?? r.event_type }));
}

export async function sealRegistered(db: Db, orderId: string) {
  const r = await one<{ seal_code: string | null }>(db, 'SELECT seal_code FROM orders WHERE id = ?', orderId);
  return !!r?.seal_code;
}
