-- 0002: planos de subscrição, suplemento Expressa, créditos expressos, cobertura de Quelimane e «Pedir recolha».
-- Fonte: «Ecrãs planos e cancelamentos» e «Pedir recolha» (novembro de 2026).

-- 1. Os 4 planos oficiais. O Admin pode editar preços, quantidades e validade no painel.
UPDATE subscription_plans SET status = 'archived', updated_at = now_iso()
 WHERE id NOT IN ('plano-basico','plano-essencial','plano-plus','plano-empresarial') AND status <> 'archived';

INSERT INTO subscription_plans (id, name, description, price_cents, period_days, deliveries_included, max_weight_kg, service_types, status) VALUES
  ('plano-basico',      'Básico',      'Para envios ocasionais.',                 30000,  60,  3, 15, '["normal","expressa"]', 'published'),
  ('plano-essencial',   'Essencial',   'Para quem envia todas as semanas.',       60000,  60,  7, 15, '["normal","expressa"]', 'published'),
  ('plano-plus',        'Plus',        'O mais escolhido. Mais encomendas por menos.', 100000, 60, 13, 15, '["normal","expressa"]', 'published'),
  ('plano-empresarial', 'Empresarial', 'Para lojas, restaurantes e farmácias.',   200000,  90, 28, 15, '["normal","expressa"]', 'published')
ON CONFLICT (id) DO NOTHING;

-- 2. Suplemento fixo da Expressa (150 MT) e tolerância de validade (a confirmar pelo Admin antes de publicar).
INSERT INTO system_settings (key, value) VALUES
  ('plans', '{"express_supplement_cents":15000,"grace_days":7,"show_plans_on_home":true}')
ON CONFLICT (key) DO NOTHING;

-- 3. Cobertura: toda a cidade de Quelimane. As zonas de cobertura continuam a decidir; deixa de haver bloqueio fixo de 15 km.
UPDATE system_settings
   SET value = jsonb_set(value::jsonb, '{max_road_distance_m}', '60000'::jsonb)::text
 WHERE key = 'limits' AND (value::jsonb->>'max_road_distance_m')::int <= 15000;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_road_distance_m_check;
ALTER TABLE orders ADD CONSTRAINT orders_road_distance_m_check CHECK (road_distance_m <= 60000);

-- 4. Tipo de pedido: envio normal ou «Pedir recolha» (o cliente pede para ir buscar algo a um estabelecimento).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_kind TEXT NOT NULL DEFAULT 'envio';
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_order_kind_check;
ALTER TABLE orders ADD CONSTRAINT orders_order_kind_check CHECK (order_kind IN ('envio','recolha'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_details TEXT;          -- JSON: tipo de estabelecimento, nome, nº do pedido
ALTER TABLE orders ADD COLUMN IF NOT EXISTS express_supplement_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS used_express_credit_id TEXT;

-- 5. Créditos expressos: nascem quando o cliente cancela uma Expressa paga antes da recolha.
--    Um crédito por pedido de origem (sem duplicados). Fica disponível mesmo que o próximo pedido seja Normal.
CREATE TABLE IF NOT EXISTS express_credits (
  id               TEXT PRIMARY KEY,
  customer_id      TEXT NOT NULL REFERENCES users(id),
  origin_order_id  TEXT NOT NULL UNIQUE,
  status           TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','used')),
  used_order_id    TEXT UNIQUE,
  created_at       TEXT NOT NULL DEFAULT now_iso(),
  updated_at       TEXT NOT NULL DEFAULT now_iso()
);
CREATE INDEX IF NOT EXISTS idx_express_credits_customer ON express_credits(customer_id, status);
