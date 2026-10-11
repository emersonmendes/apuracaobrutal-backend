import type { AnalyzerName } from '../../domain/ports/image-analyzer';

export const MODERATION_CONFIG = Symbol('MODERATION_CONFIG');

export type ModerationEffort = 'low' | 'medium' | 'high';

/** Configuração do analisador (spec sponsorship-image-moderation FR-01). Só o worker a usa. */
export interface ModerationConfig {
  analyzer: AnalyzerName;
  model: string;
  effort: ModerationEffort;
  timeoutMs: number;
  /** Presente só com `analyzer = claude`; nunca logada. */
  apiKey: string | null;
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

const EFFORTS: ModerationEffort[] = ['low', 'medium', 'high'];
export const DEFAULT_MODERATION_MODEL = 'claude-opus-5-5';
export const MIN_TIMEOUT_MS = 5_000;

/**
 * Lê e valida `SPONSORSHIP_MODERATION` e `ANTHROPIC_*` (FR-01). `simulated` é recusado em
 * produção e ignora as `ANTHROPIC_*`. As mensagens nunca ecoam a chave.
 */
export function parseModerationConfig(env: Env): ModerationConfig {
  const problems: string[] = [];
  const analyzer = value(env, 'SPONSORSHIP_MODERATION', 'claude');
  if (analyzer !== 'claude' && analyzer !== 'simulated') {
    problems.push('SPONSORSHIP_MODERATION aceita apenas "claude" ou "simulated"');
  }
  if (analyzer === 'simulated' && env.NODE_ENV === 'production') {
    problems.push('SPONSORSHIP_MODERATION=simulated não é permitido com NODE_ENV=production');
  }

  let model = DEFAULT_MODERATION_MODEL;
  let effort: ModerationEffort = 'medium';
  let timeoutMs = 60_000;
  let apiKey: string | null = null;
  if (analyzer === 'claude') {
    apiKey = value(env, 'ANTHROPIC_API_KEY', '');
    if (apiKey === '')
      problems.push('ANTHROPIC_API_KEY é obrigatória com SPONSORSHIP_MODERATION=claude');
    model = value(env, 'ANTHROPIC_MODERATION_MODEL', DEFAULT_MODERATION_MODEL);
    if (!/^[a-z0-9-]+$/.test(model)) {
      problems.push(
        'ANTHROPIC_MODERATION_MODEL deve ser um id de modelo (letras, números e hífens)',
      );
    }
    const rawEffort = value(env, 'ANTHROPIC_MODERATION_EFFORT', 'medium');
    if ((EFFORTS as string[]).includes(rawEffort)) effort = rawEffort as ModerationEffort;
    else problems.push('ANTHROPIC_MODERATION_EFFORT aceita apenas "low", "medium" ou "high"');
    const rawTimeout = value(env, 'ANTHROPIC_TIMEOUT_MS', String(timeoutMs));
    if (!/^\d+$/.test(rawTimeout) || Number(rawTimeout) < MIN_TIMEOUT_MS) {
      problems.push(
        `ANTHROPIC_TIMEOUT_MS deve ser um inteiro ≥ ${MIN_TIMEOUT_MS} (recebido: "${rawTimeout}")`,
      );
    } else {
      timeoutMs = Number(rawTimeout);
    }
  }

  if (problems.length > 0) throw new InvalidModerationConfigError(problems);
  return {
    analyzer: analyzer === 'simulated' ? 'simulated' : 'claude',
    model,
    effort,
    timeoutMs,
    apiKey: analyzer === 'claude' ? apiKey : null,
  };
}
