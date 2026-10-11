import type { PriceKey } from './slots';

/** Janela `[startsAt, endsAt)` do dia da eleição (spec sponsorship-election-pricing R-1). */
export interface ElectionDay {
  /** `AAAA-MM-DD`. */
  date: string;
  startsAt: Date;
  endsAt: Date;
}

export type PaymentGatewayName = 'simulated' | 'asaas';
export type AsaasEnvironment = 'sandbox' | 'production';

/** Acesso ao Asaas (spec asaas-payment FR-01, R-1). A chave nunca sai daqui para logs/respostas. */
export interface AsaasConfig {
  environment: AsaasEnvironment;
  /** `https://api-sandbox.asaas.com/v3` ou `https://api.asaas.com/v3` — nunca de entrada externa. */
  baseUrl: string;
  apiKey: string;
  webhookToken: string;
  timeoutMs: number;
}

/** Política de moderação aplicada pelo módulo (spec sponsorship-image-moderation FR-01, R-4, R-5). */
export interface ModerationPolicyConfig {
  /** Tentativas por pedido antes de `error` definitivo (1–5). */
  maxAttempts: number;
  /** Confiança mínima para aprovar (D-4), em `[0.5, 1]`. */
  minConfidence: number;
  /** Teto global de chamadas ao provedor por hora. */
  maxPerHour: number;
}

/** Configuração do módulo de patrocínios (spec sponsorships FR-01; asaas-payment FR-01). */
export interface SponsorshipConfig {
  gateway: PaymentGatewayName;
  /** Presente só com `gateway = asaas`. */
  asaas: AsaasConfig | null;
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
  moderation: ModerationPolicyConfig;
}

/** Compra disponível? Gateway simulado nunca vende em produção (R-9); Asaas vende sempre (asaas-payment R-1). */
export function purchaseAvailable(config: Pick<SponsorshipConfig, 'gateway' | 'production'>) {
  return !(config.production && config.gateway === 'simulated');
}

/** Nenhuma cobrança real acontece? Simulado, ou Asaas em sandbox (asaas-payment R-1). */
export function sandboxPayments(config: Pick<SponsorshipConfig, 'gateway' | 'asaas'>): boolean {
  return config.gateway === 'simulated' || config.asaas?.environment === 'sandbox';
}
