-- 0003: protecção de encomendas, cadeia de custódia e antifraude (P0).
-- Fonte: «Módulo de protecção de encomendas e cadeia de custódia» e «Plano de melhorias de segurança,
-- antifraude e operação» (01/11/2026), aprovados pelo proprietário a 02/11/2026.
-- As decisões comerciais em aberto (lacre obrigatório, fotos obrigatórias, prazos, indemnizações) ficam em
-- system_settings 'custody', editáveis no painel. Nada aqui define preços nem indemnizações.

-- 1. Declaração do remetente (guardada no próprio pedido; fica fixa depois da recolha).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS declared_value_cents INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fragile BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS declaration_accepted_at TEXT;   -- veracidade, artigos permitidos, embalagem
ALTER TABLE orders ADD COLUMN IF NOT EXISTS declaration_version TEXT;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_quantity_check;
ALTER TABLE orders ADD CONSTRAINT orders_quantity_check CHECK (quantity BETWEEN 1 AND 50);
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_declared_value_check;
ALTER TABLE orders ADD CONSTRAINT orders_declared_value_check CHECK (declared_value_cents IS NULL OR declared_value_cents >= 0);

-- 2. Código de recolha (o remetente confirma a passagem da encomenda ao estafeta). Só o hash fica guardado.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_code_hash TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_code_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS seal_code TEXT;                -- lacre registado na recolha (quando usado)

-- 3. Novo estado: recolha suspensa (embalagem aberta, danificada, insegura ou divergente).
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN (
  'AGUARDA_PAGAMENTO','PENDENTE_ATRIBUICAO','ATRIBUIDO','ACEITE','RECOLHA_BLOQUEADA','RECOLHIDO',
  'EM_TRANSPORTE','ENTREGUE','CANCELADO','FALHA_ENTREGA','DEVOLUCAO_PENDENTE','DEVOLVIDO'));

-- 4. Inspecções externas na recolha e na entrega.
CREATE TABLE IF NOT EXISTS package_inspections (
  id                  TEXT PRIMARY KEY,
  order_id            TEXT NOT NULL REFERENCES orders(id),
  stage               TEXT NOT NULL CHECK (stage IN ('pickup','dropoff')),
  inspector_id        TEXT NOT NULL REFERENCES users(id),
  packaging_condition TEXT NOT NULL CHECK (packaging_condition IN ('intacta','danificada','aberta','insegura')),
  external_match      TEXT CHECK (external_match IN ('sim','nao','nao_verificavel')),
  recipient_verdict   TEXT CHECK (recipient_verdict IN ('sem_anomalias','anomalia')),
  measured_weight_kg  DOUBLE PRECISION CHECK (measured_weight_kg IS NULL OR measured_weight_kg > 0),
  weight_method       TEXT,
  seal_code           TEXT,
  notes               TEXT,
  outcome             TEXT NOT NULL CHECK (outcome IN ('aprovada','bloqueada')),
  request_key         TEXT,
  created_at          TEXT NOT NULL DEFAULT now_iso(),
  UNIQUE (order_id, stage, request_key)
);
CREATE INDEX IF NOT EXISTS idx_inspections_order ON package_inspections(order_id, created_at);

-- 5. Cadeia de custódia: quem é responsável pela encomenda, e quando.
CREATE TABLE IF NOT EXISTS custody_events (
  id            TEXT PRIMARY KEY,
  order_id      TEXT NOT NULL REFERENCES orders(id),
  event_type    TEXT NOT NULL CHECK (event_type IN ('recolha_confirmada','recolha_suspensa','entrega_confirmada',
                  'entrega_falhada','devolucao_confirmada','transferencia','excepcao_autorizada')),
  from_party    TEXT NOT NULL,          -- remetente | estafeta:<id> | destinatario | levago
  to_party      TEXT NOT NULL,
  actor_id      TEXT REFERENCES users(id),
  method        TEXT,                   -- codigo_remetente, otp_destinatario, autorizacao_admin
  inspection_id TEXT REFERENCES package_inspections(id),
  metadata      TEXT,
  occurred_at   TEXT NOT NULL DEFAULT now_iso()
);
CREATE INDEX IF NOT EXISTS idx_custody_order ON custody_events(order_id, occurred_at);

-- 6. Ocorrências (centro de ocorrências no Admin). Substitui incident_reports, que é copiado para aqui.
CREATE TABLE IF NOT EXISTS incidents (
  id            TEXT PRIMARY KEY,
  protocol      TEXT NOT NULL UNIQUE,   -- OC-XXXXX, mostrado ao cliente
  order_id      TEXT NOT NULL REFERENCES orders(id),
  reporter_id   TEXT REFERENCES users(id),
  reporter_role TEXT NOT NULL CHECK (reporter_role IN ('customer','courier','admin','system')),
  category      TEXT NOT NULL,
  description   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'aberta'
                CHECK (status IN ('aberta','aguarda_provas','em_analise','resolvida','escalada')),
  priority      TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('baixa','normal','alta','urgente')),
  assigned_to   TEXT REFERENCES users(id),
  resolution    TEXT,
  request_key   TEXT,
  created_at    TEXT NOT NULL DEFAULT now_iso(),
  updated_at    TEXT NOT NULL DEFAULT now_iso(),
  closed_at     TEXT,
  UNIQUE (reporter_id, request_key)
);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status, created_at);
CREATE INDEX IF NOT EXISTS idx_incidents_order ON incidents(order_id);

INSERT INTO incidents (id, protocol, order_id, reporter_id, reporter_role, category, description, status, created_at, updated_at)
SELECT r.id, 'OC-' || upper(substr(md5(r.id), 1, 6)), r.order_id, r.reporter_id, 'courier', r.kind, r.description,
       CASE WHEN r.status = 'resolved' THEN 'resolvida' ELSE 'aberta' END, r.created_at, r.created_at
  FROM incident_reports r
ON CONFLICT (id) DO NOTHING;

-- Mensagens e decisões da ocorrência (só se acrescentam, nunca se apagam).
CREATE TABLE IF NOT EXISTS incident_notes (
  id          TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES incidents(id),
  author_id   TEXT REFERENCES users(id),
  author_role TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('mensagem','pedido_esclarecimento','decisao','mudanca_estado','nota_interna')),
  body        TEXT NOT NULL,
  internal    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TEXT NOT NULL DEFAULT now_iso()
);
CREATE INDEX IF NOT EXISTS idx_incident_notes ON incident_notes(incident_id, created_at);

-- 7. Provas: fotografias privadas com checksum. Nunca se substituem nem se apagam.
CREATE TABLE IF NOT EXISTS evidence_files (
  id            TEXT PRIMARY KEY,
  order_id      TEXT NOT NULL REFERENCES orders(id),
  inspection_id TEXT REFERENCES package_inspections(id),
  incident_id   TEXT REFERENCES incidents(id),
  storage_key   TEXT NOT NULL UNIQUE REFERENCES file_blobs(key),
  media_type    TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  sha256        TEXT NOT NULL,
  stage         TEXT NOT NULL CHECK (stage IN ('pickup','dropoff','incident')),
  uploaded_by   TEXT NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT now_iso(),
  retention_until TEXT
);
CREATE INDEX IF NOT EXISTS idx_evidence_order ON evidence_files(order_id);

-- 8. Sinais de risco (LevaGo Safe): só triagem, com revisão humana. Não presumem culpa.
CREATE TABLE IF NOT EXISTS risk_signals (
  id            TEXT PRIMARY KEY,
  rule_code     TEXT NOT NULL,          -- OTP_FALHADO, LACRE_DIVERGENTE, RECOLHA_SUSPENSA, CANCELAMENTO_POS_ATRIBUICAO, ...
  severity      TEXT NOT NULL CHECK (severity IN ('baixa','media','alta')),
  subject_type  TEXT NOT NULL CHECK (subject_type IN ('order','customer','courier')),
  subject_id    TEXT NOT NULL,
  order_id      TEXT REFERENCES orders(id),
  evidence      TEXT,                   -- JSON com os factos que dispararam a regra
  review_status TEXT NOT NULL DEFAULT 'pendente' CHECK (review_status IN ('pendente','confirmado','descartado')),
  reviewed_by   TEXT REFERENCES users(id),
  review_note   TEXT,
  reviewed_at   TEXT,
  dedupe_key    TEXT UNIQUE,
  created_at    TEXT NOT NULL DEFAULT now_iso()
);
CREATE INDEX IF NOT EXISTS idx_risk_status ON risk_signals(review_status, created_at);

-- 9. Registos imutáveis: histórico de estados, custódia, inspecções, provas, notas e auditoria.
CREATE OR REPLACE FUNCTION levago_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'registo_imutavel: % não pode ser alterado nem apagado', TG_TABLE_NAME;
END $$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['order_events','audit_logs','custody_events','package_inspections','evidence_files','incident_notes'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_append_only ON %I', t, t);
    EXECUTE format('CREATE TRIGGER %I_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION levago_append_only()', t, t);
  END LOOP;
END $$;

-- Ficheiros usados como prova também ficam protegidos.
CREATE OR REPLACE FUNCTION levago_protect_evidence_blob() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM evidence_files WHERE storage_key = OLD.key) THEN
    RAISE EXCEPTION 'registo_imutavel: ficheiro de prova';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS file_blobs_protect_evidence ON file_blobs;
CREATE TRIGGER file_blobs_protect_evidence BEFORE UPDATE OR DELETE ON file_blobs
FOR EACH ROW EXECUTE FUNCTION levago_protect_evidence_blob();

-- 10. Configuração editável (decisões pendentes do proprietário ficam aqui, com valores prudentes).
INSERT INTO system_settings (key, value) VALUES
  ('custody', '{"pickup_code_required":true,"pickup_photos_min":1,"dropoff_photos_min":0,"seal_required":false,"declaration_version":"declaracao-1","max_declared_value_cents":null,"otp_risk_threshold":3}')
ON CONFLICT (key) DO NOTHING;
