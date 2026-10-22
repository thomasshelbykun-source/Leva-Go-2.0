// Regras de negócio puras (sem base de dados), testadas em test/domain.test.ts.

// ------------------------------------------------------------------ Geografia
export type LonLat = [number, number];

/** Ponto dentro de polígono (ray casting). Polígono em [lon, lat]. */
export function pointInPolygon(lat: number, lon: number, polygon: LonLat[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export interface Zone {
  id: string;
  name: string;
  kind: 'coverage' | 'restricted';
  polygon: LonLat[];
}

/** Um ponto é servido se está numa zona de cobertura e fora de todas as zonas restritas. */
export function coverageFor(lat: number, lon: number, zones: Zone[]): { ok: boolean; zone?: Zone; reason?: string } {
  const restricted = zones.find((z) => z.kind === 'restricted' && pointInPolygon(lat, lon, z.polygon));
  if (restricted) return { ok: false, reason: `Local em zona restrita (${restricted.name}).` };
  const zone = zones.find((z) => z.kind === 'coverage' && pointInPolygon(lat, lon, z.polygon));
  if (!zone) return { ok: false, reason: 'Local fora da área de cobertura.' };
  return { ok: true, zone };
}

// ------------------------------------------------------------------ Horários (Africa/Maputo, UTC+2 sem horário de verão)
export const MAPUTO_OFFSET_MIN = 120;

export interface HoursRow {
  weekday: number; // 0 = domingo
  opens_at: string; // HH:MM
  closes_at: string;
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
};

/** Hora local de Maputo de um instante UTC. */
export function maputoParts(d: Date) {
  const local = new Date(d.getTime() + MAPUTO_OFFSET_MIN * 60_000);
  return {
    weekday: local.getUTCDay(),
    minutes: local.getUTCHours() * 60 + local.getUTCMinutes(),
    date: local.toISOString().slice(0, 10),
  };
}

/** Instante UTC de uma data local (YYYY-MM-DD) e minutos do dia em Maputo. */
export function maputoToUtc(date: string, minutes: number): Date {
  const base = Date.parse(`${date}T00:00:00Z`);
  return new Date(base + (minutes - MAPUTO_OFFSET_MIN) * 60_000);
}

/**
 * O serviço pode começar em `start` e terminar `durationMin` depois, dentro do mesmo turno?
 * A plataforma aceita consultas 24/7; esta verificação aplica-se à execução física.
 */
export function fitsBusinessHours(start: Date, durationMin: number, hours: HoursRow[]): { ok: boolean; reason?: string } {
  const p = maputoParts(start);
  const turns = hours.filter((h) => h.weekday === p.weekday);
  if (!turns.length) return { ok: false, reason: 'Sem serviço neste dia.' };
  for (const t of turns) {
    const o = toMin(t.opens_at);
    const c = toMin(t.closes_at);
    if (p.minutes >= o && p.minutes + durationMin <= c) return { ok: true };
  }
  const desc = turns.map((t) => `${t.opens_at}–${t.closes_at}`).join(', ');
  return { ok: false, reason: `Fora do horário de serviço (${desc}, hora de Maputo).` };
}

export interface Slot {
  start: string; // ISO UTC
  end: string;
  label: string; // HH:MM–HH:MM hora local
}

/** Janelas de agendamento de um dia local, respeitando o horário semanal e a antecedência mínima. */
export function slotsForDay(date: string, hours: HoursRow[], slotMin: number, now: Date, minLeadMin: number): Slot[] {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const out: Slot[] = [];
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  for (const t of hours.filter((h) => h.weekday === weekday)) {
    for (let m = toMin(t.opens_at); m + slotMin <= toMin(t.closes_at); m += slotMin) {
      const start = maputoToUtc(date, m);
      if (start.getTime() < now.getTime() + minLeadMin * 60_000) continue;
      out.push({ start: start.toISOString(), end: maputoToUtc(date, m + slotMin).toISOString(), label: `${fmt(m)}–${fmt(m + slotMin)}` });
    }
  }
  return out;
}

// ------------------------------------------------------------------ Limites
export const MAX_WEIGHT_KG = 15;
export const MAX_ROAD_DISTANCE_M = 15_000;

export function checkWeight(weightKg: number, max = MAX_WEIGHT_KG): string | null {
  if (!Number.isFinite(weightKg) || weightKg <= 0) return 'O peso tem de ser maior que 0 kg.';
  if (weightKg > max) return `O peso máximo é ${max} kg.`;
  return null;
}

export function checkRoadDistance(meters: number, max = MAX_ROAD_DISTANCE_M): string | null {
  if (!Number.isFinite(meters) || meters <= 0) return 'Distância por estrada inválida.';
  if (meters > max) return `O percurso por estrada tem ${(meters / 1000).toFixed(1)} km. O máximo é ${max / 1000} km.`;
  return null;
}

// ------------------------------------------------------------------ Tarifas
export interface PricingRule {
  service_type: 'normal' | 'expressa';
  base_cents: number;
  per_km_cents: number;
  per_kg_cents: number;
  min_total_cents: number;
}

export interface PriceBreakdown {
  base_cents: number;
  distance_cents: number;
  weight_cents: number;
  minimum_adjust_cents: number;
  subscription_discount_cents: number;
  total_cents: number;
}

/** Preço determinístico a partir de uma versão de tarifa (reprodutível: mesma entrada, mesmo valor). */
export function priceFor(rule: PricingRule, roadDistanceM: number, weightKg: number): PriceBreakdown {
  const base = rule.base_cents;
  const distance = Math.round((rule.per_km_cents * roadDistanceM) / 1000);
  const weight = Math.round(rule.per_kg_cents * Math.max(0, Math.ceil(weightKg) - 1)); // 1.º kg incluído
  const sum = base + distance + weight;
  const total = Math.max(sum, rule.min_total_cents);
  return {
    base_cents: base,
    distance_cents: distance,
    weight_cents: weight,
    minimum_adjust_cents: total - sum,
    subscription_discount_cents: 0,
    total_cents: total,
  };
}

// ------------------------------------------------------------------ Máquina de estados
export type OrderStatus =
  | 'AGUARDA_PAGAMENTO'
  | 'PENDENTE_ATRIBUICAO'
  | 'ATRIBUIDO'
  | 'ACEITE'
  | 'RECOLHIDO'
  | 'EM_TRANSPORTE'
  | 'ENTREGUE'
  | 'CANCELADO'
  | 'FALHA_ENTREGA'
  | 'DEVOLUCAO_PENDENTE'
  | 'DEVOLVIDO';

export type Actor = 'customer' | 'courier' | 'admin' | 'system';

export const FINAL_STATUSES: OrderStatus[] = ['ENTREGUE', 'CANCELADO', 'DEVOLVIDO'];
export const ACTIVE_COURIER_STATUSES: OrderStatus[] = ['ACEITE', 'RECOLHIDO', 'EM_TRANSPORTE'];

/** Transições permitidas e quem as pode fazer (secção 6 da especificação). */
export const TRANSITIONS: Record<OrderStatus, Partial<Record<OrderStatus, Actor[]>>> = {
  AGUARDA_PAGAMENTO: { PENDENTE_ATRIBUICAO: ['system'], CANCELADO: ['customer', 'admin', 'system'] },
  PENDENTE_ATRIBUICAO: { ATRIBUIDO: ['admin'], ACEITE: ['courier'], CANCELADO: ['customer', 'admin'] },
  ATRIBUIDO: { ACEITE: ['courier'], PENDENTE_ATRIBUICAO: ['courier', 'admin'], CANCELADO: ['admin'] },
  ACEITE: { RECOLHIDO: ['courier'], PENDENTE_ATRIBUICAO: ['admin'], CANCELADO: ['admin'] },
  RECOLHIDO: { EM_TRANSPORTE: ['courier'], FALHA_ENTREGA: ['courier', 'admin'] },
  EM_TRANSPORTE: { ENTREGUE: ['courier'], FALHA_ENTREGA: ['courier', 'admin'] },
  FALHA_ENTREGA: { EM_TRANSPORTE: ['admin'], DEVOLUCAO_PENDENTE: ['admin'] },
  DEVOLUCAO_PENDENTE: { DEVOLVIDO: ['courier', 'admin'] },
  ENTREGUE: {},
  CANCELADO: {},
  DEVOLVIDO: {},
};

export function canTransition(from: OrderStatus, to: OrderStatus, actor: Actor): boolean {
  return TRANSITIONS[from]?.[to]?.includes(actor) ?? false;
}

export const STATUS_LABELS: Record<OrderStatus, string> = {
  AGUARDA_PAGAMENTO: 'A aguardar pagamento',
  PENDENTE_ATRIBUICAO: 'À procura de estafeta',
  ATRIBUIDO: 'Estafeta atribuído',
  ACEITE: 'Estafeta a caminho da recolha',
  RECOLHIDO: 'Encomenda recolhida',
  EM_TRANSPORTE: 'Em transporte',
  ENTREGUE: 'Entregue',
  CANCELADO: 'Cancelada',
  FALHA_ENTREGA: 'Falha na entrega',
  DEVOLUCAO_PENDENTE: 'Devolução pendente',
  DEVOLVIDO: 'Devolvida',
};

/** O cliente só pode cancelar antes de um estafeta aceitar. */
export function customerCanCancel(status: OrderStatus) {
  return status === 'AGUARDA_PAGAMENTO' || status === 'PENDENTE_ATRIBUICAO';
}

// ------------------------------------------------------------------ Estafetas
/** Remuneração por entrega: independentes recebem uma percentagem; próprios seguem o contrato. */
export function courierEarning(linkType: 'proprio' | 'independente', priceCents: number, cfg: { independent_share_bps: number; own_per_delivery_cents: number }) {
  return linkType === 'independente' ? Math.round((priceCents * cfg.independent_share_bps) / 10_000) : cfg.own_per_delivery_cents;
}

export function vehicleCanCarry(vehicle: { status: string; capacity_kg: number } | null, weightKg: number) {
  return !!vehicle && vehicle.status === 'approved' && vehicle.capacity_kg >= weightKg;
}
