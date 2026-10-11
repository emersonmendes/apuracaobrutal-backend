import type { SponsorshipConfig } from '../../domain/sponsorship-config';

export const SPONSORSHIP_CONFIG = Symbol('SPONSORSHIP_CONFIG');

type Env = Record<string, string | undefined>;

/** Erro de configuração com a lista de todas as variáveis inválidas (spec sponsorships FR-01). */
export class InvalidSponsorshipConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Configuração de patrocínios inválida:\n- ${problems.join('\n- ')}`);
    this.name = 'InvalidSponsorshipConfigError';
  }
}

function value(env: Env, name: string, fallback: string): string {
  const raw = env[name]?.trim();
  return raw === undefined || raw === '' ? fallback : raw;
}

function integer(env: Env, name: string, fallback: number, min: number, problems: string[]) {
  const raw = value(env, name, String(fallback));
  if (!/^\d+$/.test(raw) || Number(raw) < min || !Number.isSafeInteger(Number(raw))) {
    problems.push(`${name} deve ser um inteiro ≥ ${min} (recebido: "${raw}")`);
    return fallback;
  }
  return Number(raw);
}

/**
 * Lê e valida a configuração de patrocínios (spec sponsorships FR-01, R-3, R-9). Qualquer valor
 * inválido impede a subida do processo.
 */
export function parseSponsorshipConfig(env: Env): SponsorshipConfig {
  const problems: string[] = [];

  const gateway = value(env, 'PAYMENT_GATEWAY', 'simulated');
  if (gateway !== 'simulated') problems.push(`PAYMENT_GATEWAY aceita apenas "simulated"`);

  const pricesCents = {
    floor: integer(env, 'SPONSORSHIP_PRICE_FLOOR_CENTS', 500_000, 1, problems),
    center: integer(env, 'SPONSORSHIP_PRICE_CENTER_CENTS', 300_000, 1, problems),
    glove: integer(env, 'SPONSORSHIP_PRICE_GLOVE_CENTS', 200_000, 1, problems),
    side: integer(env, 'SPONSORSHIP_PRICE_SIDE_CENTS', 100_000, 1, problems),
  };
  const maxMinutes = integer(env, 'SPONSORSHIP_MAX_MINUTES', 60, 1, problems);
  const leadSeconds = integer(env, 'SPONSORSHIP_LEAD_SECONDS', 60, 30, problems);
  const paymentTtlMinutes = integer(env, 'SPONSORSHIP_PAYMENT_TTL_MINUTES', 30, 5, problems);
  const imageMaxBytes = integer(env, 'SPONSORSHIP_IMAGE_MAX_BYTES', 2_097_152, 1, problems);
  const createLimitPerHour = integer(env, 'SPONSORSHIP_CREATE_LIMIT_PER_HOUR', 10, 1, problems);
  const storageDir = value(env, 'SPONSORSHIP_STORAGE_DIR', './storage/sponsorships');

  if (problems.length > 0) throw new InvalidSponsorshipConfigError(problems);

  return {
    gateway: 'simulated',
    production: env.NODE_ENV === 'production',
    pricesCents,
    maxMinutes,
    leadSeconds,
    paymentTtlMinutes,
    imageMaxBytes,
    storageDir,
    createLimitPerHour,
  };
}
