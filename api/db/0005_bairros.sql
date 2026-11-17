-- 0005: o cliente indica os locais pelo nome do bairro (17/11/2026, decisão do proprietário).
-- Cada bairro tem um ponto central usado para calcular a distância por estrada e o preço.
-- Os pontos abaixo são APROXIMADOS: o Admin deve confirmá-los (ou corrigi-los) em Zonas e bairros.
-- Um bairro activo é, por si, zona de cobertura: só aparecem ao cliente os bairros activos.
CREATE TABLE IF NOT EXISTS bairros (
  id          TEXT PRIMARY KEY,
  city        TEXT NOT NULL DEFAULT 'Quelimane',
  name        TEXT NOT NULL,
  lat         DOUBLE PRECISION NOT NULL,
  lon         DOUBLE PRECISION NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  updated_by  TEXT REFERENCES users(id),
  updated_at  TEXT NOT NULL DEFAULT now_iso()
);
-- O mesmo nome não se repete na mesma cidade (sem contar maiúsculas).
CREATE UNIQUE INDEX IF NOT EXISTS ux_bairros_nome ON bairros (city, lower(name));

INSERT INTO bairros (id, name, lat, lon) VALUES
 ('bairro-cimento',        'Cimento (Baixa)',  -17.8790, 36.8880),
 ('bairro-aeroporto',      'Aeroporto',        -17.8620, 36.8700),
 ('bairro-brandao',        'Brandão',          -17.8700, 36.8950),
 ('bairro-chuabo-dembe',   'Chuabo Dembe',     -17.8600, 36.8850),
 ('bairro-coalane',        'Coalane',          -17.8500, 36.9050),
 ('bairro-icidua',         'Icídua',           -17.8850, 36.9150),
 ('bairro-janeiro',        'Janeiro',          -17.8720, 36.8800),
 ('bairro-liberdade',      'Liberdade',        -17.8680, 36.9050),
 ('bairro-manhaua',        'Manhaua',          -17.8550, 36.8950),
 ('bairro-mirazane',       'Mirazane',         -17.8780, 36.9050),
 ('bairro-namuinho',       'Namuinho',         -17.8450, 36.8800),
 ('bairro-popular',        'Popular',          -17.8750, 36.8950),
 ('bairro-sangariveira',   'Sangariveira',     -17.8900, 36.9000),
 ('bairro-santagua',       'Santagua',         -17.8650, 36.8900),
 ('bairro-torrone-velho',  'Torrone Velho',    -17.8820, 36.8750),
 ('bairro-torrone-novo',   'Torrone Novo',     -17.8900, 36.8700),
 ('bairro-1-maio',         '1º de Maio',       -17.8740, 36.9000),
 ('bairro-maquival',       'Maquival',         -17.8400, 36.9150),
 ('bairro-madal',          'Madal',            -17.8550, 36.9300)
ON CONFLICT DO NOTHING;
