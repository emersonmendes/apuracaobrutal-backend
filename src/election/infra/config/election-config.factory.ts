import type { ElectionConfig, Ed25519Jwk } from '../../domain/election-config';

/**
 * Chave pública oficial do TSE para os arquivos da divulgação 2026 (manual de verificação JWS,
 * Apêndice B — ambiente oficial). Spec: election-results-feed FR-01.
 */
export const OFFICIAL_TSE_JWK: Ed25519Jwk = {
  kty: 'OKP',
  crv: 'Ed25519',
  kid: 'sNbt9Q_fLS65zE1_ZLNV-XRRwPY',
  x: 'kWlpNHjuws1csyQZwzn3Fhzbi3RD435RbpThtSr4hMc',
};

export const ELECTION_CONFIG = Symbol('ELECTION_CONFIG');

type Env = Record<string, string | undefined>;

/** Erro de configuração com a lista de todas as variáveis inválidas (AC-01). */
export class InvalidElectionConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Configuração da eleição inválida:\n- ${problems.join('\n- ')}`);
    this.name = 'InvalidElectionConfigError';
  }
}

function value(env: Env, name: string, fallback: string): string {
  const raw = env[name]?.trim();
  return raw === undefined || raw === '' ? fallback : raw;
}

function integer(
  env: Env,
  name: string,
  fallback: number,
  min: number,
  problems: string[],
): number {
  const raw = value(env, name, String(fallback));
  if (!/^\d+$/.test(raw) || Number(raw) < min) {
    problems.push(`${name} deve ser um inteiro ≥ ${min} (recebido: "${raw}")`);
    return fallback;
  }
  return Number(raw);
}

function parseJwk(raw: string | undefined, problems: string[]): Ed25519Jwk {
  if (raw === undefined || raw.trim() === '') return OFFICIAL_TSE_JWK;
  try {
    const jwk: unknown = JSON.parse(raw);
    if (
      typeof jwk === 'object' &&
      jwk !== null &&
      (jwk as Record<string, unknown>).kty === 'OKP' &&
      (jwk as Record<string, unknown>).crv === 'Ed25519' &&
      typeof (jwk as Record<string, unknown>).x === 'string' &&
      typeof (jwk as Record<string, unknown>).kid === 'string'
    ) {
      const { x, kid } = jwk as { x: string; kid: string };
      return { kty: 'OKP', crv: 'Ed25519', x, kid };
    }
  } catch {
    // tratado abaixo
  }
  problems.push('TSE_JWS_PUBLIC_JWK deve ser uma JWK Ed25519 (kty OKP, crv Ed25519, x, kid)');
  return OFFICIAL_TSE_JWK;
}

/**
 * Lê e valida a configuração da eleição a partir do ambiente (spec election-results-feed FR-01).
 * Qualquer valor inválido impede a subida do processo.
 */
export function parseElectionConfig(env: Env): ElectionConfig {
  const problems: string[] = [];

  const resultsUrl = value(env, 'TSE_RESULTS_URL', 'https://resultados.tse.jus.br/oficial');
  let validUrl = false;
  try {
    validUrl = new URL(resultsUrl).protocol === 'https:' && !resultsUrl.endsWith('/');
  } catch {
    validUrl = false;
  }
  if (!validUrl) problems.push(`TSE_RESULTS_URL deve ser uma URL https sem barra final`);

  const cycle = value(env, 'TSE_CYCLE', 'ele2026');
  if (!/^ele\d{4}$/.test(cycle)) problems.push(`TSE_CYCLE deve casar com eleAAAA`);

  const electionCode = value(env, 'TSE_ELECTION_CODE', '6258');
  if (!/^\d{1,6}$/.test(electionCode)) problems.push(`TSE_ELECTION_CODE deve ter 1 a 6 dígitos`);

  const jwk = parseJwk(env.TSE_JWS_PUBLIC_JWK, problems);

  const red = integer(env, 'ELECTION_RED_CANDIDATE_NUMBER', 13, 1, problems);
  const blue = integer(env, 'ELECTION_BLUE_CANDIDATE_NUMBER', 22, 1, problems);
  if (red === blue) problems.push('ELECTION_RED_CANDIDATE_NUMBER e _BLUE_ devem ser diferentes');

  const pollIntervalSeconds = integer(env, 'TSE_POLL_INTERVAL_SECONDS', 15, 5, problems);
  const staleAfterSeconds = integer(env, 'SOURCE_STALE_AFTER_SECONDS', 90, 1, problems);
  if (staleAfterSeconds < 2 * pollIntervalSeconds) {
    problems.push('SOURCE_STALE_AFTER_SECONDS deve ser ≥ 2 × TSE_POLL_INTERVAL_SECONDS');
  }
  const feedRefreshMs = integer(env, 'FEED_REFRESH_MS', 2000, 500, problems);
  const sseMaxClients = integer(env, 'SSE_MAX_CLIENTS', 5000, 1, problems);

  if (problems.length > 0) throw new InvalidElectionConfigError(problems);

  return {
    resultsUrl,
    cycle,
    electionCode,
    jwk,
    sides: { red, blue },
    pollIntervalSeconds,
    staleAfterSeconds,
    feedRefreshMs,
    sseMaxClients,
  };
}
