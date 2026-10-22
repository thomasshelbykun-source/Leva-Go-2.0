import { describe, expect, it } from 'vitest';
import {
  canTransition, checkRoadDistance, checkWeight, courierEarning, coverageFor, fitsBusinessHours, maputoToUtc, priceFor, slotsForDay, vehicleCanCarry,
  type HoursRow, type LonLat,
} from '../src/lib/domain.js';
import { normalizePhone } from '../src/lib/core.js';

// Horário aprovado (secção 0): dom–qui 07–22, sex 07–16, sáb 17–22.
const HOURS: HoursRow[] = [
  ...[0, 1, 2, 3, 4].map((d) => ({ weekday: d, opens_at: '07:00', closes_at: '22:00' })),
  { weekday: 5, opens_at: '07:00', closes_at: '16:00' },
  { weekday: 6, opens_at: '17:00', closes_at: '22:00' },
];

describe('BR-01 distância por estrada até 15 km', () => {
  it('aceita 15,0 km e rejeita 15,1 km', () => {
    expect(checkRoadDistance(15_000)).toBeNull();
    expect(checkRoadDistance(15_100)).toMatch(/15\.1 km/);
  });
  it('rejeita distância inválida', () => {
    expect(checkRoadDistance(0)).not.toBeNull();
    expect(checkRoadDistance(Number.NaN)).not.toBeNull();
  });
});

describe('BR-02 peso até 15 kg e capacidade do veículo', () => {
  it('aceita 15 kg, rejeita 16 kg e 0 kg', () => {
    expect(checkWeight(15)).toBeNull();
    expect(checkWeight(16)).toMatch(/15 kg/);
    expect(checkWeight(0)).not.toBeNull();
  });
  it('bicicleta com capacidade 8 kg não leva 10 kg, mesmo abaixo de 15', () => {
    expect(vehicleCanCarry({ status: 'approved', capacity_kg: 8 }, 10)).toBe(false);
    expect(vehicleCanCarry({ status: 'approved', capacity_kg: 8 }, 8)).toBe(true);
  });
  it('veículo pendente não recebe tarefas', () => {
    expect(vehicleCanCarry({ status: 'pending', capacity_kg: 15 }, 1)).toBe(false);
    expect(vehicleCanCarry(null, 1)).toBe(false);
  });
});

describe('BR-03 horários locais (Africa/Maputo)', () => {
  // 2026-10-23 é sexta-feira.
  it('sexta depois das 16:00 é rejeitado', () => {
    expect(fitsBusinessHours(maputoToUtc('2026-10-23', 16 * 60 + 5), 0, HOURS).ok).toBe(false);
  });
  it('sexta às 15:00 com 30 min de serviço é aceite; com 90 min já não termina antes do fecho', () => {
    expect(fitsBusinessHours(maputoToUtc('2026-10-23', 15 * 60), 30, HOURS).ok).toBe(true);
    expect(fitsBusinessHours(maputoToUtc('2026-10-23', 15 * 60), 90, HOURS).ok).toBe(false);
  });
  it('sábado de manhã fechado, sábado às 18:00 aberto', () => {
    expect(fitsBusinessHours(maputoToUtc('2026-10-24', 10 * 60), 0, HOURS).ok).toBe(false);
    expect(fitsBusinessHours(maputoToUtc('2026-10-24', 18 * 60), 0, HOURS).ok).toBe(true);
  });
  it('converte hora de Maputo para UTC (UTC+2)', () => {
    expect(maputoToUtc('2026-10-23', 7 * 60).toISOString()).toBe('2026-10-23T05:00:00.000Z');
  });
  it('janelas de agendamento respeitam horário e antecedência, sem datas passadas', () => {
    const now = maputoToUtc('2026-10-23', 12 * 60);
    const slots = slotsForDay('2026-10-23', HOURS, 60, now, 60);
    expect(slots.map((s) => s.label)).toEqual(['13:00–14:00', '14:00–15:00', '15:00–16:00']);
    expect(slotsForDay('2026-10-22', HOURS, 60, now, 60)).toEqual([]);
  });
});

describe('BR-04 tarifa versionada por modalidade', () => {
  const normal = { service_type: 'normal' as const, base_cents: 5000, per_km_cents: 1500, per_kg_cents: 500, min_total_cents: 8000 };
  const expressa = { ...normal, service_type: 'expressa' as const, base_cents: 8000, per_km_cents: 2000 };
  it('é reprodutível e discrimina componentes', () => {
    const a = priceFor(normal, 4200, 3.2);
    expect(a).toEqual(priceFor(normal, 4200, 3.2));
    expect(a.base_cents + a.distance_cents + a.weight_cents + a.minimum_adjust_cents).toBe(a.total_cents);
    expect(a.distance_cents).toBe(6300);
    expect(a.weight_cents).toBe(1500); // 4 kg arredondado, 1.º kg incluído
  });
  it('aplica o mínimo', () => {
    expect(priceFor(normal, 500, 1).total_cents).toBe(8000);
  });
  it('expressa custa mais que normal no mesmo percurso', () => {
    expect(priceFor(expressa, 5000, 2).total_cents).toBeGreaterThan(priceFor(normal, 5000, 2).total_cents);
  });
});

describe('Máquina de estados (secção 6)', () => {
  it('só o estafeta designado avança recolha e entrega', () => {
    expect(canTransition('ACEITE', 'RECOLHIDO', 'courier')).toBe(true);
    expect(canTransition('ACEITE', 'RECOLHIDO', 'customer')).toBe(false);
    expect(canTransition('EM_TRANSPORTE', 'ENTREGUE', 'admin')).toBe(false);
  });
  it('pagamento só é confirmado pelo sistema', () => {
    expect(canTransition('AGUARDA_PAGAMENTO', 'PENDENTE_ATRIBUICAO', 'customer')).toBe(false);
    expect(canTransition('AGUARDA_PAGAMENTO', 'PENDENTE_ATRIBUICAO', 'system')).toBe(true);
  });
  it('estados finais não têm saída', () => {
    for (const to of ['PENDENTE_ATRIBUICAO', 'CANCELADO', 'EM_TRANSPORTE'] as const) {
      expect(canTransition('ENTREGUE', to, 'admin')).toBe(false);
      expect(canTransition('CANCELADO', to, 'admin')).toBe(false);
    }
  });
  it('não se salta etapas', () => {
    expect(canTransition('ACEITE', 'ENTREGUE', 'courier')).toBe(false);
    expect(canTransition('PENDENTE_ATRIBUICAO', 'RECOLHIDO', 'courier')).toBe(false);
  });
});

describe('Cobertura', () => {
  const square: LonLat[] = [[36.8, -17.8], [36.95, -17.8], [36.95, -17.95], [36.8, -17.95], [36.8, -17.8]];
  const hole: LonLat[] = [[36.85, -17.85], [36.86, -17.85], [36.86, -17.86], [36.85, -17.86], [36.85, -17.85]];
  const zones = [
    { id: 'a', name: 'Quelimane', kind: 'coverage' as const, polygon: square },
    { id: 'b', name: 'Porto', kind: 'restricted' as const, polygon: hole },
  ];
  it('dentro, fora e em zona restrita', () => {
    expect(coverageFor(-17.88, 36.89, zones).ok).toBe(true);
    expect(coverageFor(-18.5, 36.89, zones).ok).toBe(false);
    expect(coverageFor(-17.855, 36.855, zones).reason).toMatch(/restrita/);
  });
});

describe('Remuneração e telefones', () => {
  it('independente recebe percentagem, próprio segue contrato', () => {
    const cfg = { independent_share_bps: 7000, own_per_delivery_cents: 0 };
    expect(courierEarning('independente', 10_000, cfg)).toBe(7000);
    expect(courierEarning('proprio', 10_000, cfg)).toBe(0);
  });
  it('normaliza telemóveis de Moçambique', () => {
    expect(normalizePhone('84 123 4567')).toBe('+258841234567');
    expect(normalizePhone('+258 86 123 4567')).toBe('+258861234567');
    expect(normalizePhone('21123456')).toBeNull();
  });
});
