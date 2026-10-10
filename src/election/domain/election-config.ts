// Configuração da eleição acompanhada (spec election-results-feed FR-01). Só tipos e constantes —
// a leitura do ambiente fica em infra/config.

/** Chave pública Ed25519 no formato JWK usada na verificação JWS (R-1). */
export interface Ed25519Jwk {
  kty: 'OKP';
  crv: 'Ed25519';
  x: string;
  kid: string;
}

/** Números na urna que definem os lados (R-5). */
export interface CandidateSides {
  red: number;
  blue: number;
}

export interface ElectionConfig {
  /** Prefixo `<host>/<ambiente>`, sem barra final. */
  resultsUrl: string;
  /** Pasta do ciclo, ex.: `ele2026`. */
  cycle: string;
  /** Código da eleição, só dígitos (sem zeros à esquerda obrigatórios). */
  electionCode: string;
  jwk: Ed25519Jwk;
  sides: CandidateSides;
  pollIntervalSeconds: number;
  staleAfterSeconds: number;
  feedRefreshMs: number;
  sseMaxClients: number;
}

/** As 27 UFs, em ordem alfabética (FR-06). */
export const UF_SCOPES = [
  'ac',
  'al',
  'am',
  'ap',
  'ba',
  'ce',
  'df',
  'es',
  'go',
  'ma',
  'mg',
  'ms',
  'mt',
  'pa',
  'pb',
  'pe',
  'pi',
  'pr',
  'rj',
  'rn',
  'ro',
  'rr',
  'rs',
  'sc',
  'se',
  'sp',
  'to',
] as const;

export type UfScope = (typeof UF_SCOPES)[number];

/** Escopo consultado: Brasil ou uma UF (o exterior `zz` não é consultado). */
export type Scope = 'br' | UfScope;

/** Todos os escopos de um ciclo: `br` + 27 UFs (R-11). */
export const ALL_SCOPES: readonly Scope[] = ['br', ...UF_SCOPES];

/** Ano exibido: os 4 dígitos finais do ciclo (`ele2026` → 2026). */
export function electionYear(cycle: string): number {
  return Number(cycle.slice(-4));
}

/** Código da eleição com 6 dígitos, como no nome do arquivo (`6258` → `006258`). */
export function paddedElectionCode(electionCode: string): string {
  return electionCode.padStart(6, '0');
}
