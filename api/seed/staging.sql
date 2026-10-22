-- Dados de TESTE para staging. NÃO usar em produção.
-- A zona e a tabela de preços abaixo são exemplos para testar o fluxo; não estão aprovadas.

INSERT OR IGNORE INTO service_zones (id, city, name, kind, polygon) VALUES
 ('zone-quelimane-centro', 'Quelimane', 'Quelimane (cobertura de teste)', 'coverage',
  '[[36.835,-17.835],[36.905,-17.825],[36.955,-17.845],[36.965,-17.890],[36.940,-17.925],[36.880,-17.935],[36.835,-17.910],[36.825,-17.870],[36.835,-17.835]]');

INSERT OR IGNORE INTO pricing_versions (id, version, status, note, published_at) VALUES
 ('pricing-test-1', 1, 'published', 'Tabela de TESTE (staging). Valores ilustrativos, não aprovados.', strftime('%Y-%m-%dT%H:%M:%fZ','now'));

INSERT OR IGNORE INTO pricing_rules (pricing_version_id, service_type, base_cents, per_km_cents, per_kg_cents, min_total_cents) VALUES
 ('pricing-test-1', 'normal',   5000, 1500, 500,  8000),
 ('pricing-test-1', 'expressa', 8000, 2000, 500, 12000);
