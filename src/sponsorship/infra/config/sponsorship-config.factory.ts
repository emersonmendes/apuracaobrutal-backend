import { standardTable } from '../../domain/pricing';
import type {
  AsaasConfig,
  ElectionDay,
  SponsorshipConfig,
  StorageConfig,
} from '../../domain/sponsorship-config';

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

const ELECTION_TIME_ZONE = 'America/Sao_Paulo';
const DAY_MS = 86_400_000;

/** Offset (ms) do fuso no instante dado: hora local − UTC, pelo banco de fusos do ICU. */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((part) => part.type === type)!.value);
  const local = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return local - instant;
}

/**
 * Primeiro instante do dia local `y-m-d` no fuso, como instante UTC (offset real da data, sem
 * offset fixo). Se a 00:00 cair num salto de horário de verão, é o primeiro instante que existe.
 */
function startOfLocalDay(y: number, m: number, d: number, timeZone: string): Date {
  const naive = Date.UTC(y, m - 1, d);
  const beforeShift = naive - zoneOffsetMs(naive, timeZone);
  const afterShift = naive - zoneOffsetMs(beforeShift, timeZone);
  const isTargetDay = (instant: number) => {
    const local = new Date(instant + zoneOffsetMs(instant, timeZone));
    return local.getUTCDate() === d && local.getUTCMonth() === m - 1;
  };
  const candidates = [Math.min(beforeShift, afterShift), Math.max(beforeShift, afterShift)];
  return new Date(candidates.find(isTargetDay) ?? afterShift);
}

/**
 * Dia da eleição `AAAA-MM-DD` → janela `[00:00, 00:00 do dia seguinte)` em `America/Sao_Paulo`
 * (spec sponsorship-election-pricing R-1). Data malformada ou inexistente → `null`.
 */
export function electionDayOf(date: string): ElectionDay | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const [y, m, d] = match.slice(1).map(Number);
  const calendar = new Date(Date.UTC(y, m - 1, d));
  if (
    calendar.getUTCFullYear() !== y ||
    calendar.getUTCMonth() !== m - 1 ||
    calendar.getUTCDate() !== d
  ) {
    return null;
  }
  const next = new Date(Date.UTC(y, m - 1, d) + DAY_MS);
  return {
    date,
    startsAt: startOfLocalDay(y, m, d, ELECTION_TIME_ZONE),
    endsAt: startOfLocalDay(
      next.getUTCFullYear(),
      next.getUTCMonth() + 1,
      next.getUTCDate(),
      ELECTION_TIME_ZONE,
    ),
  };
}

const ASAAS_BASE_URL: Record<AsaasConfig['environment'], string> = {
  sandbox: 'https://api-sandbox.asaas.com/v3',
  production: 'https://api.asaas.com/v3',
};

/**
 * Acesso ao Asaas (spec asaas-payment FR-01, R-1): chave e token obrigatórios; token com 32–255
 * caracteres, sem espaços e diferente da chave. As mensagens nunca ecoam o valor da chave.
 */
function parseAsaasConfig(env: Env, problems: string[]): AsaasConfig {
  const environment = value(env, 'ASAAS_ENVIRONMENT', 'sandbox');
  if (environment !== 'sandbox' && environment !== 'production') {
    problems.push(`ASAAS_ENVIRONMENT aceita apenas "sandbox" ou "production"`);
  }
  const apiKey = value(env, 'ASAAS_API_KEY', '');
  if (apiKey === '') problems.push('ASAAS_API_KEY é obrigatória com PAYMENT_GATEWAY=asaas');
  const webhookToken = value(env, 'ASAAS_WEBHOOK_TOKEN', '');
  if (webhookToken === '') {
    problems.push('ASAAS_WEBHOOK_TOKEN é obrigatório com PAYMENT_GATEWAY=asaas');
  } else if (webhookToken.length < 32 || webhookToken.length > 255 || /\s/.test(webhookToken)) {
    problems.push('ASAAS_WEBHOOK_TOKEN deve ter 32–255 caracteres sem espaços');
  } else if (webhookToken === apiKey) {
    problems.push('ASAAS_WEBHOOK_TOKEN não pode ser igual à ASAAS_API_KEY');
  }
  const timeoutMs = integer(env, 'ASAAS_TIMEOUT_MS', 10_000, 1_000, problems);
  const resolved = environment === 'production' ? 'production' : 'sandbox';
  return {
    environment: resolved,
    baseUrl: ASAAS_BASE_URL[resolved],
    apiKey,
    webhookToken,
    timeoutMs,
  };
}

/**
 * Lê e valida a configuração de patrocínios (spec sponsorships FR-01, R-3, R-9;
 * sponsorship-election-pricing FR-01; asaas-payment FR-01). Qualquer valor inválido impede a
 * subida do processo.
 */
/**
 * `SPONSORSHIP_WORKER_ENABLED` (spec sponsorships FR-01, FR-05): só o worker lê. `false` desliga os
 * laços de patrocínio (limpeza, estorno, moderação); padrão `true`; outro valor não sobe.
 */
const DEFAULT_REGION = 'us-east-1';
/** Mesma validação de `AWS_REGION` da moderação (sponsorship-image-moderation FR-01). */
const REGION_PATTERN = /^[a-z]{2}(-[a-z]+)+-\d$/;
/** Nome de bucket: 3–63 caracteres `a-z0-9.-`, começa e termina com letra ou dígito. */
const BUCKET_PATTERN = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

/**
 * Onde as imagens ficam (spec sponsorship-s3-storage FR-01, R-1, R-4): `local` (padrão; recusado
 * em produção) ou `s3`. Com `local`, as `SPONSORSHIP_S3_*` são ignoradas.
 */
function parseStorageConfig(env: Env, problems: string[]): StorageConfig {
  const kind = value(env, 'SPONSORSHIP_STORAGE', 'local');
  const production = env.NODE_ENV === 'production';
  if (kind !== 'local' && kind !== 's3') {
    problems.push('SPONSORSHIP_STORAGE aceita apenas "local" ou "s3"');
  }
  if (kind !== 's3') {
    if (production) {
      problems.push(
        'SPONSORSHIP_STORAGE=local não é permitido com NODE_ENV=production (backend e worker não compartilham disco)',
      );
    }
    return { kind: 'local', dir: value(env, 'SPONSORSHIP_STORAGE_DIR', './storage/sponsorships') };
  }
  const bucket = value(env, 'SPONSORSHIP_S3_BUCKET', '');
  if (bucket === '')
    problems.push('SPONSORSHIP_S3_BUCKET é obrigatória com SPONSORSHIP_STORAGE=s3');
  else if (!BUCKET_PATTERN.test(bucket)) {
    problems.push(
      `SPONSORSHIP_S3_BUCKET deve ser um nome de bucket válido (recebido: "${bucket}")`,
    );
  }
  const region = value(env, 'AWS_REGION', DEFAULT_REGION);
  if (!REGION_PATTERN.test(region)) {
    problems.push(`AWS_REGION deve ser uma região da AWS, ex.: us-east-1 (recebido: "${region}")`);
  }
  const rawProfile = value(env, 'AWS_PROFILE', '');
  const endpoint = value(env, 'SPONSORSHIP_S3_ENDPOINT', '');
  if (endpoint !== '' && !/^https?:\/\/\S+$/.test(endpoint)) {
    problems.push('SPONSORSHIP_S3_ENDPOINT deve ser uma URL http(s)://');
  }
  if (endpoint !== '' && production) {
    problems.push('SPONSORSHIP_S3_ENDPOINT não é permitida com NODE_ENV=production');
  }
  const timeoutMs = integer(env, 'SPONSORSHIP_S3_TIMEOUT_MS', 10_000, 1_000, problems);
  return {
    kind: 's3',
    bucket,
    region,
    profile: rawProfile === '' ? null : rawProfile,
    endpoint: endpoint === '' ? null : endpoint,
    timeoutMs,
  };
}

export function parseSponsorshipWorkerEnabled(env: Env): boolean {
  const raw = value(env, 'SPONSORSHIP_WORKER_ENABLED', 'true').toLowerCase();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new InvalidSponsorshipConfigError([
    `SPONSORSHIP_WORKER_ENABLED deve ser "true" ou "false" (recebido: "${env.SPONSORSHIP_WORKER_ENABLED}")`,
  ]);
}

export function parseSponsorshipConfig(env: Env): SponsorshipConfig {
  const problems: string[] = [];

  const gateway = value(env, 'PAYMENT_GATEWAY', 'simulated');
  if (gateway !== 'simulated' && gateway !== 'asaas') {
    problems.push(`PAYMENT_GATEWAY aceita apenas "simulated" ou "asaas"`);
  }
  const asaas = gateway === 'asaas' ? parseAsaasConfig(env, problems) : null;

  const pricesCents = {
    floor: integer(env, 'SPONSORSHIP_PRICE_FLOOR_CENTS', 500_000, 1, problems),
    center: integer(env, 'SPONSORSHIP_PRICE_CENTER_CENTS', 300_000, 1, problems),
    glove: integer(env, 'SPONSORSHIP_PRICE_GLOVE_CENTS', 200_000, 1, problems),
    side: integer(env, 'SPONSORSHIP_PRICE_SIDE_CENTS', 100_000, 1, problems),
  };
  const standardSideCents = integer(env, 'SPONSORSHIP_STANDARD_PRICE_SIDE_CENTS', 500, 1, problems);
  const standardPricesCents = standardTable(pricesCents, standardSideCents);
  for (const [key, cents] of Object.entries(standardPricesCents)) {
    if (cents < 1) problems.push(`preço reduzido de "${key}" ficaria < 1 centavo`);
  }
  const electionDate = value(env, 'SPONSORSHIP_ELECTION_DATE', '2026-10-25');
  const electionDay = electionDayOf(electionDate);
  if (!electionDay) {
    problems.push(
      `SPONSORSHIP_ELECTION_DATE deve ser uma data AAAA-MM-DD (recebido: "${electionDate}")`,
    );
  }
  const maxMinutes = integer(env, 'SPONSORSHIP_MAX_MINUTES', 60, 1, problems);
  const paymentTtlMinutes = integer(env, 'SPONSORSHIP_PAYMENT_TTL_MINUTES', 30, 5, problems);
  const imageMaxBytes = integer(env, 'SPONSORSHIP_IMAGE_MAX_BYTES', 3_145_728, 1, problems);
  const createLimitPerHour = integer(env, 'SPONSORSHIP_CREATE_LIMIT_PER_HOUR', 10, 1, problems);
  const storage = parseStorageConfig(env, problems);

  // Moderação automática (sponsorship-image-moderation FR-01).
  const maxAttempts = integer(env, 'SPONSORSHIP_MODERATION_MAX_ATTEMPTS', 3, 1, problems);
  if (maxAttempts > 5) problems.push('SPONSORSHIP_MODERATION_MAX_ATTEMPTS deve ser ≤ 5');
  const maxPerHour = integer(env, 'SPONSORSHIP_MODERATION_MAX_PER_HOUR', 200, 1, problems);

  if (problems.length > 0) throw new InvalidSponsorshipConfigError(problems);

  return {
    gateway: gateway === 'asaas' ? 'asaas' : 'simulated',
    asaas,
    production: env.NODE_ENV === 'production',
    pricesCents,
    standardPricesCents,
    electionDay: electionDay!,
    maxMinutes,
    paymentTtlMinutes,
    imageMaxBytes,
    storage,
    createLimitPerHour,
    moderation: { maxAttempts, maxPerHour },
  };
}
