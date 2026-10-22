// Adaptadores de integrações externas. Cada um pode ser trocado sem mexer nas regras de negócio.
import { ApiError, type Env } from './core';

// ------------------------------------------------------------------ Rotas por estrada
export interface RouteResult {
  distance_m: number;
  duration_s: number;
  provider: string;
  geometry?: [number, number][]; // [lat, lon] para desenhar no mapa
}

/**
 * Distância por estrada entre dois pontos. Se o provedor falhar, devolve erro explícito.
 * NUNCA estimar por linha recta como distância contratual (especificação, secção 9).
 */
export async function roadRoute(env: Env, from: { lat: number; lon: number }, to: { lat: number; lon: number }): Promise<RouteResult> {
  if (env.ENVIRONMENT === 'test') return testRoute(from, to);
  const base = env.ROUTING_OSRM_URL;
  if (!base) throw new ApiError(503, 'rotas_indisponiveis', 'O serviço de rotas não está configurado.');
  const url = `${base.replace(/\/$/, '')}/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=simplified&geometries=geojson`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'User-Agent': 'LevaGo/2.0 (levago.co.mz)' }, signal: AbortSignal.timeout(8000) });
  } catch {
    throw new ApiError(503, 'rotas_indisponiveis', 'Não foi possível calcular a rota agora. Tente de novo dentro de momentos.');
  }
  if (!res.ok) throw new ApiError(503, 'rotas_indisponiveis', 'O serviço de rotas respondeu com erro. Tente de novo.');
  const data = (await res.json()) as { code: string; routes?: { distance: number; duration: number; geometry?: { coordinates: [number, number][] } }[] };
  const r = data.routes?.[0];
  if (data.code !== 'Ok' || !r) throw new ApiError(422, 'rota_inexistente', 'Não existe percurso por estrada entre estes locais.');
  return {
    distance_m: Math.round(r.distance),
    duration_s: Math.round(r.duration),
    provider: 'osrm',
    geometry: r.geometry?.coordinates.map(([lon, lat]) => [lat, lon]),
  };
}

/** Só no ambiente de testes automáticos: 1,3 × a distância directa, para resultados previsíveis. */
function testRoute(from: { lat: number; lon: number }, to: { lat: number; lon: number }): RouteResult {
  const R = 6371000;
  const dLat = ((to.lat - from.lat) * Math.PI) / 180;
  const dLon = ((to.lon - from.lon) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((from.lat * Math.PI) / 180) * Math.cos((to.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  const d = 2 * R * Math.asin(Math.sqrt(a)) * 1.3;
  return { distance_m: Math.round(d), duration_s: Math.round(d / 6), provider: 'test' };
}

// ------------------------------------------------------------------ Pesquisa de moradas
export interface Place {
  label: string;
  lat: number;
  lon: number;
}

export async function searchPlaces(env: Env, q: string): Promise<Place[]> {
  if (env.ENVIRONMENT === 'test') return [{ label: `${q}, Quelimane`, lat: -17.8786, lon: 36.8883 }];
  const base = env.GEOCODER_URL;
  if (!base) throw new ApiError(503, 'pesquisa_indisponivel', 'A pesquisa de moradas não está configurada.');
  const url = `${base.replace(/\/$/, '')}/search?format=jsonv2&limit=6&countrycodes=mz&viewbox=36.80,-17.80,37.00,-17.95&bounded=0&q=${encodeURIComponent(q)}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'LevaGo/2.0 (levago.co.mz)', 'Accept-Language': 'pt' }, signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error();
    const rows = (await res.json()) as { display_name: string; lat: string; lon: string }[];
    return rows.map((r) => ({ label: r.display_name, lat: Number(r.lat), lon: Number(r.lon) }));
  } catch {
    throw new ApiError(503, 'pesquisa_indisponivel', 'A pesquisa de moradas falhou. Escolha o local no mapa.');
  }
}

export async function reversePlace(env: Env, lat: number, lon: number): Promise<string> {
  if (env.ENVIRONMENT === 'test' || !env.GEOCODER_URL) return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  try {
    const res = await fetch(`${env.GEOCODER_URL}/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18`, {
      headers: { 'User-Agent': 'LevaGo/2.0 (levago.co.mz)', 'Accept-Language': 'pt' },
      signal: AbortSignal.timeout(5000),
    });
    const r = (await res.json()) as { display_name?: string };
    return r.display_name ?? `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  } catch {
    return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  }
}

// ------------------------------------------------------------------ SMS / OTP
/** Envia o código. Sem provedor configurado (pendência), o código só é devolvido fora de produção. */
export async function sendOtp(env: Env, phone: string, code: string): Promise<{ delivered: boolean; devCode?: string }> {
  if (env.SMS_PROVIDER_URL && env.SMS_PROVIDER_KEY) {
    const res = await fetch(env.SMS_PROVIDER_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.SMS_PROVIDER_KEY}` },
      body: JSON.stringify({ to: phone, text: `LevaGo: o seu código é ${code}. Não o partilhe.` }),
    });
    return { delivered: res.ok };
  }
  if (env.ENVIRONMENT === 'production') throw new ApiError(503, 'sms_indisponivel', 'O envio de SMS ainda não está configurado.');
  return { delivered: false, devCode: code };
}

// ------------------------------------------------------------------ Pagamentos
export type PaymentProvider = 'mpesa' | 'emola' | 'sandbox';

/**
 * Inicia a cobrança no provedor. M-Pesa e e-Mola ficam desligados até existir acesso oficial
 * às APIs (pendência 14.3). Em staging usa-se o provedor "sandbox", confirmado por webhook simulado.
 */
export async function startCharge(env: Env, provider: PaymentProvider, intent: { id: string; amount_cents: number; msisdn: string }) {
  if (provider === 'sandbox') {
    if (env.ENVIRONMENT === 'production') throw new ApiError(400, 'metodo_indisponivel', 'Pagamento de teste não disponível em produção.');
    return { provider_ref: `SBX-${intent.id.slice(0, 8)}` };
  }
  throw new ApiError(503, 'metodo_indisponivel', `${provider === 'mpesa' ? 'M-Pesa' : 'e-Mola'} ainda não está disponível. A integração oficial está pendente.`);
}
