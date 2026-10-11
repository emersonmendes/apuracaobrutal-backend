import type { PriceKey } from './slots';

/** Janela `[startsAt, endsAt)` do dia da eleição (spec sponsorship-election-pricing R-1). */
export interface ElectionDay {
  /** `AAAA-MM-DD`. */
  date: string;
  startsAt: Date;
  endsAt: Date;
}

/** Configuração do módulo de patrocínios (spec sponsorships FR-01). */
export interface SponsorshipConfig {
  gateway: 'simulated';
  /** `NODE_ENV === 'production'` — com gateway simulado, a compra fica indisponível (R-9). */
  production: boolean;
  /** Tabela cheia: preço/min no dia da eleição (spec sponsorship-election-pricing R-2). */
  pricesCents: Record<PriceKey, number>;
  /** Tabela reduzida, proporcional à cheia: vale fora do dia da eleição (R-2). */
  standardPricesCents: Record<PriceKey, number>;
  /** Dia da eleição em `America/Sao_Paulo`, já convertido em instantes (R-1). */
  electionDay: ElectionDay;
  maxMinutes: number;
  paymentTtlMinutes: number;
  imageMaxBytes: number;
  storageDir: string;
  createLimitPerHour: number;
}

/** Compra disponível? Gateway simulado nunca vende em produção (R-9). */
export function purchaseAvailable(config: Pick<SponsorshipConfig, 'gateway' | 'production'>) {
  return !(config.production && config.gateway === 'simulated');
}
