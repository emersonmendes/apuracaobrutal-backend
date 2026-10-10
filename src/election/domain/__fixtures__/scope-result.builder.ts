// Construtor de ScopeResult para testes (dados de teste, nunca exibidos como resultado).
import type { ElectionConfig, Scope } from '../election-config';
import type { ScopeResult } from '../scope-result';

export const SIDES = { red: 13, blue: 22 };

export const TEST_CONFIG: ElectionConfig = {
  resultsUrl: 'https://resultados.tse.jus.br/oficial',
  cycle: 'ele2026',
  electionCode: '6258',
  jwk: {
    kty: 'OKP',
    crv: 'Ed25519',
    kid: 'test-kid',
    x: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  },
  sides: SIDES,
  pollIntervalSeconds: 15,
  staleAfterSeconds: 90,
  feedRefreshMs: 2000,
  sseMaxClients: 5000,
};

export interface ResultOptions extends Partial<ScopeResult> {
  /** `validVotesPct` do vermelho (13) e do azul (22). */
  redPct?: number;
  bluePct?: number;
  redElected?: boolean;
  blueElected?: boolean;
}

/** Brasília → Date (`'2026-10-25T20:00:00'`). */
export function brt(local: string): Date {
  return new Date(`${local}-03:00`);
}

export function makeResult(options: ResultOptions = {}): ScopeResult {
  const {
    redPct = 52.5,
    bluePct = 47.5,
    redElected = false,
    blueElected = false,
    ...overrides
  } = options;
  const scope: Scope = overrides.scope ?? 'br';
  return {
    electionCode: '6258',
    scope,
    round: 2,
    phase: 'o',
    generationId: '1000',
    generatedAt: brt('2026-10-25T20:00:00'),
    totalizedAt: brt('2026-10-25T19:59:00'),
    disclosable: true,
    progress: 'p',
    final: false,
    noWinnerAssigned: false,
    sectionsTotal: 1000,
    sectionsCounted: 400,
    countedSectionsPct: 40,
    electorate: 1_000_000,
    validVotes: 500_000,
    candidates: [
      {
        number: 22,
        sqcand: '280002551544',
        ballotName: 'FLAVIO BOLSONARO',
        party: 'PL',
        votes: Math.round(bluePct * 5000),
        validVotesPct: bluePct,
        elected: blueElected,
        situation: null,
      },
      {
        number: 13,
        sqcand: '280002542548',
        ballotName: 'LULA',
        party: 'PT',
        votes: Math.round(redPct * 5000),
        validVotesPct: redPct,
        elected: redElected,
        situation: null,
      },
    ],
    ...overrides,
  };
}
