import type { PriceKey } from './slots';

/** Configuração do módulo de patrocínios (spec sponsorships FR-01). */
export interface SponsorshipConfig {
  gateway: 'simulated';
  /** `NODE_ENV === 'production'` — com gateway simulado, a compra fica indisponível (R-9). */
  production: boolean;
  pricesCents: Record<PriceKey, number>;
  maxMinutes: number;
  leadSeconds: number;
  paymentTtlMinutes: number;
  imageMaxBytes: number;
  storageDir: string;
  createLimitPerHour: number;
}

/** Compra disponível? Gateway simulado nunca vende em produção (R-9). */
export function purchaseAvailable(config: Pick<SponsorshipConfig, 'gateway' | 'production'>) {
  return !(config.production && config.gateway === 'simulated');
}
