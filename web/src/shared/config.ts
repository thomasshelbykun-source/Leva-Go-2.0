import { useEffect, useState } from 'react';
import { api } from './api';

export interface PublicConfig {
  environment: string;
  hours: { weekday: number; opens_at: string; closes_at: string }[];
  open_now: boolean;
  zones: { id: string; name: string; kind: 'coverage' | 'restricted'; polygon: [number, number][]; city: string }[];
  payment_methods: { mpesa: boolean; emola: boolean; sandbox: boolean; na_entrega: boolean };
  pricing_published: boolean;
  limits?: { max_weight_kg: number; max_road_distance_m: number };
  company?: { name?: string; support_phone?: string; support_email?: string };
  [k: string]: unknown;
}

let cache: Promise<PublicConfig> | null = null;

/** Configuração pública (horários, zonas, métodos de pagamento). Carregada uma vez por visita. */
export function useConfig() {
  const [cfg, setCfg] = useState<PublicConfig | null>(null);
  useEffect(() => {
    cache ??= api('cliente').get<PublicConfig>('/config').catch((e) => {
      cache = null;
      throw e;
    });
    cache.then(setCfg).catch(() => setCfg(null));
  }, []);
  return cfg;
}
