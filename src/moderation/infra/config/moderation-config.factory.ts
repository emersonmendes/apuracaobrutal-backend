import type { AnalyzerName } from '../../domain/ports/image-analyzer';

export const MODERATION_CONFIG = Symbol('MODERATION_CONFIG');

/** Configuração do analisador (spec sponsorship-image-moderation FR-01). Só o worker a usa. */
export interface ModerationConfig {
  analyzer: AnalyzerName;
  /** Região do Rekognition. */
  region: string;
  /** Profile do `~/.aws` (desenvolvimento); nulo → cadeia padrão do SDK. */
  profile: string | null;
  /** Timeout de cada tentativa (as três chamadas juntas). */
  timeoutMs: number;
  /** Confiança mínima (0–100) de um rótulo para recusar (R-4 D-2/D-3). */
  labelMinConfidence: number;
  /** `MatchConfidence` mínima (0–100) de um rosto reconhecido (R-4 D-6). */
  celebrityMinConfidence: number;
}

type Env = Record<string, string | undefined>;

export class InvalidModerationConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Configuração da moderação de imagens inválida:\n- ${problems.join('\n- ')}`);
    this.name = 'InvalidModerationConfigError';
  }
}

function value(env: Env, name: string, fallback: string): string {
  const raw = env[name]?.trim();
  return raw === undefined || raw === '' ? fallback : raw;
}

export const DEFAULT_REGION = 'us-east-1';
export const DEFAULT_TIMEOUT_MS = 15_000;
export const MIN_TIMEOUT_MS = 2_000;
export const DEFAULT_LABEL_MIN_CONFIDENCE = 60;
export const DEFAULT_CELEBRITY_MIN_CONFIDENCE = 90;
const REGION_PATTERN = /^[a-z]{2}(-[a-z]+)+-\d$/;

function integer(
  env: Env,
  name: string,
  fallback: number,
  min: number,
  max: number,
  problems: string[],
): number {
  const raw = value(env, name, String(fallback));
  if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max) {
    problems.push(`${name} deve ser um inteiro entre ${min} e ${max} (recebido: "${raw}")`);
    return fallback;
  }
  return Number(raw);
}

/**
 * Lê e valida `SPONSORSHIP_MODERATION`, `AWS_REGION`, `AWS_PROFILE`, `REKOGNITION_TIMEOUT_MS` e
 * os limiares (FR-01). `simulated` é recusado em produção e ignora as demais. Nenhuma variável
 * `ANTHROPIC_*` é lida. As mensagens nunca ecoam credenciais.
 */
export function parseModerationConfig(env: Env): ModerationConfig {
  const problems: string[] = [];
  const analyzer = value(env, 'SPONSORSHIP_MODERATION', 'rekognition');
  if (analyzer !== 'rekognition' && analyzer !== 'simulated') {
    problems.push('SPONSORSHIP_MODERATION aceita apenas "rekognition" ou "simulated"');
  }
  if (analyzer === 'simulated' && env.NODE_ENV === 'production') {
    problems.push('SPONSORSHIP_MODERATION=simulated não é permitido com NODE_ENV=production');
  }

  let region = DEFAULT_REGION;
  let profile: string | null = null;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let labelMinConfidence = DEFAULT_LABEL_MIN_CONFIDENCE;
  let celebrityMinConfidence = DEFAULT_CELEBRITY_MIN_CONFIDENCE;
  if (analyzer === 'rekognition') {
    region = value(env, 'AWS_REGION', DEFAULT_REGION);
    if (!REGION_PATTERN.test(region)) {
      problems.push(
        `AWS_REGION deve ser uma região da AWS, ex.: us-east-1 (recebido: "${region}")`,
      );
    }
    const rawProfile = value(env, 'AWS_PROFILE', '');
    profile = rawProfile === '' ? null : rawProfile;
    const rawTimeout = value(env, 'REKOGNITION_TIMEOUT_MS', String(DEFAULT_TIMEOUT_MS));
    if (!/^\d+$/.test(rawTimeout) || Number(rawTimeout) < MIN_TIMEOUT_MS) {
      problems.push(
        `REKOGNITION_TIMEOUT_MS deve ser um inteiro ≥ ${MIN_TIMEOUT_MS} (recebido: "${rawTimeout}")`,
      );
    } else {
      timeoutMs = Number(rawTimeout);
    }
    labelMinConfidence = integer(
      env,
      'SPONSORSHIP_MODERATION_LABEL_MIN_CONFIDENCE',
      DEFAULT_LABEL_MIN_CONFIDENCE,
      50,
      100,
      problems,
    );
    celebrityMinConfidence = integer(
      env,
      'SPONSORSHIP_MODERATION_CELEBRITY_MIN_CONFIDENCE',
      DEFAULT_CELEBRITY_MIN_CONFIDENCE,
      50,
      100,
      problems,
    );
  }

  if (problems.length > 0) throw new InvalidModerationConfigError(problems);
  return {
    analyzer: analyzer === 'simulated' ? 'simulated' : 'rekognition',
    region,
    profile,
    timeoutMs,
    labelMinConfidence,
    celebrityMinConfidence,
  };
}
