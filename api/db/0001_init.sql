-- LevaGo 2.0: esquema inicial (Neon / PostgreSQL)
-- Regras gerais:
--   * Chaves primárias UUID em texto.
--   * Datas em UTC, formato ISO 8601 (o ecrã converte para Africa/Maputo).
--   * Valores em dinheiro em centavos de metical (MZN), inteiros.
--   * Estados finais de encomendas são imutáveis (ver triggers no fim).

-- Data actual em ISO 8601 UTC com milissegundos, igual ao formato que a API grava.
CREATE OR REPLACE FUNCTION now_iso() RETURNS TEXT LANGUAGE sql STABLE AS
$$ SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;

-- ---------------------------------------------------------------- Identidade
CREATE TABLE users (
  id              TEXT PRIMARY KEY,
  phone           TEXT NOT NULL UNIQUE,          -- formato E.164, ex.: +258841234567
  name            TEXT NOT NULL,
  email           TEXT,
  password_hash   TEXT NOT NULL,                 -- pbkdf2$iteracoes$salt$hash
  phone_verified_at TEXT,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  failed_logins   INTEGER NOT NULL DEFAULT 0,
  locked_until    TEXT,
  consent_terms_at   TEXT NOT NULL,
  consent_privacy_at TEXT NOT NULL,
  locale          TEXT NOT NULL DEFAULT 'pt-MZ',
  theme           TEXT NOT NULL DEFAULT 'system',
  notify_prefs    TEXT NOT NULL DEFAULT '{"orders":true,"promos":false}',
  created_at      TEXT NOT NULL DEFAULT now_iso(),
  updated_at      TEXT NOT NULL DEFAULT now_iso()
);

CREATE TABLE user_roles (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('customer','courier','admin','super_admin')),
  granted_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT now_iso(),
  PRIMARY KEY (user_id, role)
);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  app         TEXT NOT NULL CHECK (app IN ('cliente','estafeta','admin')),
  expires_at  TEXT NOT NULL,
  revoked_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT now_iso()
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE phone_verifications (
  id          TEXT PRIMARY KEY,
  phone       TEXT NOT NULL,
  purpose     TEXT NOT NULL CHECK (purpose IN ('register','reset','change_phone')),
  code_hash   TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  payload     TEXT,                            -- dados do registo pendente (JSON)
  created_at  TEXT NOT NULL DEFAULT now_iso()
);
CREATE INDEX idx_phone_verif_phone ON phone_verifications(phone, created_at);

CREATE TABLE rate_limits (
  key         TEXT NOT NULL,
  bucket      TEXT NOT NULL,
  hits        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, bucket)
);

CREATE TABLE customer_addresses (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  description TEXT NOT NULL,
  lat         DOUBLE PRECISION NOT NULL,
  lon         DOUBLE PRECISION NOT NULL,
  created_at  TEXT NOT NULL DEFAULT now_iso()
);
CREATE INDEX idx_addresses_user ON customer_addresses(user_id);

CREATE TABLE account_deletion_requests (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  reason      TEXT,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','rejected')),
  created_at  TEXT NOT NULL DEFAULT now_iso()
);

-- ---------------------------------------------------------------- Estafetas
CREATE TABLE service_zones (
  id          TEXT PRIMARY KEY,
  city        TEXT NOT NULL,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'coverage' CHECK (kind IN ('coverage','restricted')),
  polygon     TEXT NOT NULL,                   -- GeoJSON: [[lon,lat],...]
  version     INTEGER NOT NULL DEFAULT 1,
  active      INTEGER NOT NULL DEFAULT 1,
  updated_by  TEXT REFERENCES users(id),
  updated_at  TEXT NOT NULL DEFAULT now_iso()
);

CREATE TABLE courier_applications (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  link_type     TEXT NOT NULL CHECK (link_type IN ('proprio','independente')),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewer_id   TEXT REFERENCES users(id),
  review_note   TEXT,
  reviewed_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT now_iso()
);
CREATE INDEX idx_courier_app_status ON courier_applications(status, created_at);

CREATE TABLE courier_profiles (
  user_id       TEXT PRIMARY KEY REFERENCES users(id),
  link_type     TEXT NOT NULL CHECK (link_type IN ('proprio','independente')),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended')),
  is_online     INTEGER NOT NULL DEFAULT 0,
  zone_id       TEXT REFERENCES service_zones(id),
  rating_avg    DOUBLE PRECISION,
  rating_count  INTEGER NOT NULL DEFAULT 0,
  approved_at   TEXT,
  updated_at    TEXT NOT NULL DEFAULT now_iso()
);

CREATE TABLE vehicles (
  id             TEXT PRIMARY KEY,
  courier_id     TEXT NOT NULL REFERENCES users(id),
  kind           TEXT NOT NULL CHECK (kind IN ('bicicleta','motorizada')),
  plate          TEXT,
  ownership      TEXT NOT NULL CHECK (ownership IN ('empresa','particular')),
  capacity_kg    DOUBLE PRECISION NOT NULL CHECK (capacity_kg > 0 AND capacity_kg <= 15),
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  review_note    TEXT,
  created_at     TEXT NOT NULL DEFAULT now_iso(),
  updated_at     TEXT NOT NULL DEFAULT now_iso()
);
CREATE INDEX idx_vehicles_courier ON vehicles(courier_id);

CREATE TABLE courier_documents (
  id           TEXT PRIMARY KEY,
  courier_id   TEXT NOT NULL REFERENCES users(id),
  vehicle_id   TEXT REFERENCES vehicles(id),
  kind         TEXT NOT NULL CHECK (kind IN ('bi','carta_conducao','livrete','seguro','foto','outro')),
  r2_key       TEXT NOT NULL,
  content_type TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at   TEXT NOT NULL DEFAULT now_iso()
);

-- ---------------------------------------------------------------- Operação e tarifas
CREATE TABLE business_hours (
  weekday     INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),   -- 0 = domingo
  opens_at    TEXT NOT NULL,                                       -- HH:MM, hora de Maputo
  closes_at   TEXT NOT NULL,
  PRIMARY KEY (weekday, opens_at)
);

CREATE TABLE pricing_versions (
  id            TEXT PRIMARY KEY,
  version       INTEGER NOT NULL UNIQUE,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','retired')),
  note          TEXT,
  created_by    TEXT REFERENCES users(id),
  published_by  TEXT REFERENCES users(id),
  published_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT now_iso()
);

CREATE TABLE pricing_rules (
  pricing_version_id TEXT NOT NULL REFERENCES pricing_versions(id) ON DELETE CASCADE,
  service_type       TEXT NOT NULL CHECK (service_type IN ('normal','expressa')),
  base_cents         INTEGER NOT NULL CHECK (base_cents >= 0),
  per_km_cents       INTEGER NOT NULL CHECK (per_km_cents >= 0),
  per_kg_cents       INTEGER NOT NULL CHECK (per_kg_cents >= 0),
  min_total_cents    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (pricing_version_id, service_type)
);

CREATE TABLE quotes (
  id                  TEXT PRIMARY KEY,
  customer_id         TEXT NOT NULL REFERENCES users(id),
  pickup_lat DOUBLE PRECISION NOT NULL, pickup_lon DOUBLE PRECISION NOT NULL, pickup_text TEXT NOT NULL,
  dropoff_lat DOUBLE PRECISION NOT NULL, dropoff_lon DOUBLE PRECISION NOT NULL, dropoff_text TEXT NOT NULL,
  weight_kg           DOUBLE PRECISION NOT NULL,
  service_type        TEXT NOT NULL,
  road_distance_m     INTEGER NOT NULL,
  estimated_duration_s INTEGER NOT NULL,
  route_provider      TEXT NOT NULL,
  route_geometry      TEXT,
  pricing_version_id  TEXT NOT NULL REFERENCES pricing_versions(id),
  breakdown           TEXT NOT NULL,            -- JSON com a tarifa discriminada
  total_cents         INTEGER NOT NULL,
  scheduled_at        TEXT,
  expires_at          TEXT NOT NULL,
  used_at             TEXT,
  created_at          TEXT NOT NULL DEFAULT now_iso()
);
CREATE INDEX idx_quotes_customer ON quotes(customer_id, created_at);

-- ---------------------------------------------------------------- Subscrições
CREATE TABLE subscription_plans (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  description          TEXT NOT NULL DEFAULT '',
  price_cents          INTEGER NOT NULL CHECK (price_cents >= 0),
  period_days          INTEGER NOT NULL DEFAULT 30,
  deliveries_included  INTEGER NOT NULL CHECK (deliveries_included >= 0),
  max_weight_kg        DOUBLE PRECISION NOT NULL DEFAULT 15,
  service_types        TEXT NOT NULL DEFAULT '["normal"]',
  status               TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  created_at           TEXT NOT NULL DEFAULT now_iso(),
  updated_at           TEXT NOT NULL DEFAULT now_iso()
);

CREATE TABLE subscriptions (
  id              TEXT PRIMARY KEY,
  customer_id     TEXT NOT NULL REFERENCES users(id),
  plan_id         TEXT NOT NULL REFERENCES subscription_plans(id),
  plan_snapshot   TEXT NOT NULL,                -- condições contratadas (não mudam com o plano)
  status          TEXT NOT NULL DEFAULT 'pending_payment'
                  CHECK (status IN ('pending_payment','active','cancelled','expired')),
  auto_renew      INTEGER NOT NULL DEFAULT 1,
  current_period_start TEXT,
  current_period_end   TEXT,
  cancelled_at    TEXT,
  created_at      TEXT NOT NULL DEFAULT now_iso()
);
CREATE INDEX idx_subs_customer ON subscriptions(customer_id, status);

CREATE TABLE subscription_entitlements (
  id               TEXT PRIMARY KEY,
  subscription_id  TEXT NOT NULL REFERENCES subscriptions(id),
  period_start     TEXT NOT NULL,
  period_end       TEXT NOT NULL,
  deliveries_total INTEGER NOT NULL,
  deliveries_used  INTEGER NOT NULL DEFAULT 0 CHECK (deliveries_used <= deliveries_total),
  UNIQUE (subscription_id, period_start)
);

CREATE TABLE entitlement_usages (
  order_id         TEXT PRIMARY KEY,           -- uma encomenda consome no máximo 1 benefício
  entitlement_id   TEXT NOT NULL REFERENCES subscription_entitlements(id),
  created_at       TEXT NOT NULL DEFAULT now_iso()
);

CREATE TABLE invoices (
  id               TEXT PRIMARY KEY,
  customer_id      TEXT NOT NULL REFERENCES users(id),
  subscription_id  TEXT REFERENCES subscriptions(id),
  order_id         TEXT,
  amount_cents     INTEGER NOT NULL,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid','void')),
  created_at       TEXT NOT NULL DEFAULT now_iso()
);

-- ---------------------------------------------------------------- Encomendas
CREATE TABLE orders (
  id                    TEXT PRIMARY KEY,
  code                  TEXT NOT NULL UNIQUE,              -- ex.: LG-7K4Q2
  customer_id           TEXT NOT NULL REFERENCES users(id),
  quote_id              TEXT NOT NULL UNIQUE REFERENCES quotes(id),
  idempotency_key       TEXT NOT NULL,
  pickup_snapshot       TEXT NOT NULL,          -- JSON {text, lat, lon, contact}
  dropoff_snapshot      TEXT NOT NULL,          -- JSON {text, lat, lon}
  recipient_name        TEXT NOT NULL,
  recipient_phone       TEXT NOT NULL,
  category              TEXT NOT NULL,
  description           TEXT NOT NULL,
  notes                 TEXT,
  weight_kg             DOUBLE PRECISION NOT NULL CHECK (weight_kg > 0 AND weight_kg <= 15),
  service_type          TEXT NOT NULL CHECK (service_type IN ('normal','expressa')),
  road_distance_m       INTEGER NOT NULL CHECK (road_distance_m <= 15000),
  price_cents           INTEGER NOT NULL,
  pricing_snapshot      TEXT NOT NULL,
  payment_method        TEXT NOT NULL CHECK (payment_method IN ('mpesa','emola','sandbox','na_entrega','subscricao')),
  payment_status        TEXT NOT NULL DEFAULT 'pending'
                        CHECK (payment_status IN ('pending','succeeded','failed','refunded','not_required','collect_on_delivery')),
  status                TEXT NOT NULL CHECK (status IN (
                          'AGUARDA_PAGAMENTO','PENDENTE_ATRIBUICAO','ATRIBUIDO','ACEITE','RECOLHIDO',
                          'EM_TRANSPORTE','ENTREGUE','CANCELADO','FALHA_ENTREGA','DEVOLUCAO_PENDENTE','DEVOLVIDO')),
  scheduled_at          TEXT,
  assigned_courier_id   TEXT REFERENCES users(id),
  delivery_code_hash    TEXT NOT NULL,          -- código único gerado no servidor
  delivery_code_attempts INTEGER NOT NULL DEFAULT 0,
  cancel_reason         TEXT,
  created_at            TEXT NOT NULL DEFAULT now_iso(),
  updated_at            TEXT NOT NULL DEFAULT now_iso(),
  UNIQUE (customer_id, idempotency_key)
);
CREATE INDEX idx_orders_customer ON orders(customer_id, created_at);
CREATE INDEX idx_orders_status ON orders(status, created_at);
CREATE INDEX idx_orders_courier ON orders(assigned_courier_id, status);
CREATE INDEX idx_orders_scheduled ON orders(scheduled_at);

CREATE TABLE order_events (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL REFERENCES orders(id),
  from_status TEXT,
  to_status   TEXT NOT NULL,
  actor_id    TEXT REFERENCES users(id),
  actor_role  TEXT NOT NULL,
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT now_iso()
);
CREATE INDEX idx_order_events_order ON order_events(order_id, created_at);

CREATE TABLE assignments (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL REFERENCES orders(id),
  courier_id  TEXT NOT NULL REFERENCES users(id),
  assigned_by TEXT REFERENCES users(id),           -- NULL = aceite directo pelo estafeta
  status      TEXT NOT NULL CHECK (status IN ('offered','accepted','declined','revoked','completed')),
  reason      TEXT,
  created_at  TEXT NOT NULL DEFAULT now_iso(),
  responded_at TEXT
);
CREATE INDEX idx_assign_order ON assignments(order_id);
CREATE INDEX idx_assign_courier ON assignments(courier_id, status);

CREATE TABLE location_updates (
  courier_id  TEXT PRIMARY KEY REFERENCES users(id),  -- só a última posição
  order_id    TEXT REFERENCES orders(id),
  lat         DOUBLE PRECISION NOT NULL,
  lon         DOUBLE PRECISION NOT NULL,
  accuracy_m  DOUBLE PRECISION,
  updated_at  TEXT NOT NULL DEFAULT now_iso()
);

CREATE TABLE delivery_proofs (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL REFERENCES orders(id),
  kind        TEXT NOT NULL CHECK (kind IN ('pickup','delivery')),
  method      TEXT NOT NULL,                    -- codigo, foto, checklist
  checklist   TEXT,
  photo_r2_key TEXT,
  lat DOUBLE PRECISION, lon DOUBLE PRECISION,
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT now_iso(),
  UNIQUE (order_id, kind)
);

CREATE TABLE incident_reports (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL REFERENCES orders(id),
  reporter_id TEXT NOT NULL REFERENCES users(id),
  kind        TEXT NOT NULL,
  description TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at  TEXT NOT NULL DEFAULT now_iso()
);

CREATE TABLE ratings (
  order_id      TEXT PRIMARY KEY REFERENCES orders(id),
  courier_id    TEXT REFERENCES users(id),
  stars         INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment       TEXT,
  created_at    TEXT NOT NULL DEFAULT now_iso()
);

-- ---------------------------------------------------------------- Pagamentos
CREATE TABLE payment_intents (
  id               TEXT PRIMARY KEY,
  customer_id      TEXT NOT NULL REFERENCES users(id),
  order_id         TEXT REFERENCES orders(id),
  subscription_id  TEXT REFERENCES subscriptions(id),
  provider         TEXT NOT NULL CHECK (provider IN ('mpesa','emola','sandbox')),
  amount_cents     INTEGER NOT NULL CHECK (amount_cents > 0),
  msisdn           TEXT NOT NULL,              -- número a cobrar (nunca o PIN)
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','failed','refunded')),
  provider_ref     TEXT UNIQUE,
  idempotency_key  TEXT NOT NULL UNIQUE,
  failure_reason   TEXT,
  created_at       TEXT NOT NULL DEFAULT now_iso(),
  updated_at       TEXT NOT NULL DEFAULT now_iso()
);
CREATE INDEX idx_pi_order ON payment_intents(order_id);
CREATE INDEX idx_pi_status ON payment_intents(status, created_at);

CREATE TABLE payment_transactions (
  id               TEXT PRIMARY KEY,
  intent_id        TEXT NOT NULL REFERENCES payment_intents(id),
  provider_event_id TEXT NOT NULL UNIQUE,      -- garante idempotência de webhooks
  kind             TEXT NOT NULL CHECK (kind IN ('charge','refund')),
  status           TEXT NOT NULL,
  amount_cents     INTEGER NOT NULL,
  raw              TEXT,
  created_at       TEXT NOT NULL DEFAULT now_iso()
);

CREATE TABLE refunds (
  id            TEXT PRIMARY KEY,
  intent_id     TEXT NOT NULL REFERENCES payment_intents(id),
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
  reason        TEXT NOT NULL,
  requested_by  TEXT NOT NULL REFERENCES users(id),
  approved_by   TEXT REFERENCES users(id),
  status        TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','rejected','done')),
  created_at    TEXT NOT NULL DEFAULT now_iso()
);

CREATE TABLE payouts (
  id            TEXT PRIMARY KEY,
  courier_id    TEXT NOT NULL REFERENCES users(id),
  amount_cents  INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid')),
  reference     TEXT,
  created_by    TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT now_iso(),
  paid_at       TEXT
);

CREATE TABLE earnings_ledger (
  id           TEXT PRIMARY KEY,
  courier_id   TEXT NOT NULL REFERENCES users(id),
  order_id     TEXT REFERENCES orders(id),
  kind         TEXT NOT NULL CHECK (kind IN ('entrega','ajuste','liquidacao')),
  amount_cents INTEGER NOT NULL,
  note         TEXT,
  payout_id    TEXT REFERENCES payouts(id),
  created_at   TEXT NOT NULL DEFAULT now_iso(),
  UNIQUE (courier_id, order_id, kind)
);
CREATE INDEX idx_ledger_courier ON earnings_ledger(courier_id, created_at);

CREATE TABLE earning_disputes (
  id          TEXT PRIMARY KEY,
  ledger_id   TEXT NOT NULL REFERENCES earnings_ledger(id),
  courier_id  TEXT NOT NULL REFERENCES users(id),
  message     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at  TEXT NOT NULL DEFAULT now_iso()
);

-- ---------------------------------------------------------------- Comunicação e suporte
CREATE TABLE notifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  event_id    TEXT NOT NULL,                    -- evita duplicados
  category    TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  order_id    TEXT,
  read_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT now_iso(),
  UNIQUE (user_id, event_id)
);
CREATE INDEX idx_notif_user ON notifications(user_id, created_at);

CREATE TABLE support_tickets (
  id          TEXT PRIMARY KEY,
  opened_by   TEXT NOT NULL REFERENCES users(id),
  opener_role TEXT NOT NULL,
  order_id    TEXT REFERENCES orders(id),
  subject     TEXT NOT NULL,
  priority    TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('baixa','normal','alta','urgente')),
  status      TEXT NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','em_curso','resolvido','fechado')),
  assignee_id TEXT REFERENCES users(id),
  sla_due_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT now_iso(),
  updated_at  TEXT NOT NULL DEFAULT now_iso()
);
CREATE INDEX idx_tickets_opener ON support_tickets(opened_by);
CREATE INDEX idx_tickets_status ON support_tickets(status, priority);

CREATE TABLE ticket_messages (
  id          TEXT PRIMARY KEY,
  ticket_id   TEXT NOT NULL REFERENCES support_tickets(id),
  author_id   TEXT NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL,
  internal    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT now_iso()
);

-- ---------------------------------------------------------------- Administração
CREATE TABLE system_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,                    -- JSON
  version     INTEGER NOT NULL DEFAULT 1,
  updated_by  TEXT REFERENCES users(id),
  updated_at  TEXT NOT NULL DEFAULT now_iso()
);

CREATE TABLE audit_logs (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT REFERENCES users(id),
  actor_role  TEXT NOT NULL,
  action      TEXT NOT NULL,
  entity      TEXT NOT NULL,
  entity_id   TEXT,
  reason      TEXT,
  before_json TEXT,
  after_json  TEXT,
  created_at  TEXT NOT NULL DEFAULT now_iso()
);
CREATE INDEX idx_audit_entity ON audit_logs(entity, entity_id);
CREATE INDEX idx_audit_created ON audit_logs(created_at);

-- Ficheiros privados (documentos e fotos dos estafetas). Pequenos (até 4 MB), guardados na própria base.
CREATE TABLE file_blobs (
  key          TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  data         BYTEA NOT NULL,
  created_at   TEXT NOT NULL DEFAULT now_iso()
);

-- ---------------------------------------------------------------- Invariantes
-- Estados finais não mudam.
CREATE FUNCTION orders_final_state_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('ENTREGUE','CANCELADO','DEVOLVIDO') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'estado_final_imutavel';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER orders_final_state_immutable BEFORE UPDATE OF status ON orders
FOR EACH ROW EXECUTE FUNCTION orders_final_state_immutable();

-- O histórico de eventos, de mensagens de suporte e da auditoria não se edita nem se apaga.
CREATE FUNCTION history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'historico_imutavel';
END $$;
CREATE TRIGGER order_events_no_change BEFORE UPDATE OR DELETE ON order_events FOR EACH ROW EXECUTE FUNCTION history_immutable();
CREATE TRIGGER ticket_messages_no_update BEFORE UPDATE ON ticket_messages FOR EACH ROW EXECUTE FUNCTION history_immutable();
CREATE TRIGGER audit_no_change BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION history_immutable();

-- ---------------------------------------------------------------- Dados aprovados pela especificação
-- Horário operacional (Africa/Maputo). 0 = domingo ... 6 = sábado.
INSERT INTO business_hours (weekday, opens_at, closes_at) VALUES
  (0,'07:00','22:00'),(1,'07:00','22:00'),(2,'07:00','22:00'),(3,'07:00','22:00'),(4,'07:00','22:00'),
  (5,'07:00','16:00'),
  (6,'17:00','22:00');

INSERT INTO system_settings (key, value) VALUES
  ('company', '{"name":"LevaGo","slogan":"A tua entrega, o nosso compromisso!","city":"Quelimane","timezone":"Africa/Maputo","currency":"MZN"}'),
  ('limits', '{"max_weight_kg":15,"max_road_distance_m":15000,"quote_ttl_minutes":10}'),
  ('payments', '{"mpesa_enabled":false,"emola_enabled":false,"sandbox_enabled":true,"pay_on_delivery_enabled":false,"pay_on_delivery_max_cents":0}'),
  ('courier_pay', '{"independent_share_bps":7000,"own_per_delivery_cents":0}'),
  ('scheduling', '{"slot_minutes":60,"capacity_per_slot":5,"max_days_ahead":7,"min_lead_minutes":60}'),
  ('service_types', '{"normal":{"label":"Normal","enabled":true,"estimate":"Prioridade normal"},"expressa":{"label":"Expressa","enabled":true,"estimate":"Prioridade máxima, sujeita a disponibilidade"}}'),
  ('app', '{"min_version":"2.0.0","maintenance":false}');
