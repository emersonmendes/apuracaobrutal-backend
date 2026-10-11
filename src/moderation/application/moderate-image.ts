import { AnalyzerError, type AnalyzerErrorCode } from '../domain/errors';
import {
  decide,
  MODERATION_POLICY_VERSION,
  type DecisionContext,
  type Verdict,
} from '../domain/policy';
import type {
  AnalyzeImageInput,
  AnalyzerName,
  AnalyzerResult,
  ImageAnalyzer,
} from '../domain/ports/image-analyzer';
import { normalizeSignals, type ImageSignals } from '../domain/signals';

export type ModerateImageErrorCode = AnalyzerErrorCode | 'invalid_response';

interface AttemptMeta {
  provider: AnalyzerName;
  model: string | null;
  requestId: string | null;
  latencyMs: number;
}

/** Resultado de **uma** tentativa (spec sponsorship-image-moderation FR-04, R-5). */
export type ModerationAttemptResult =
  | ({
      outcome: 'approved' | 'rejected';
      verdict: Verdict;
      signals: ImageSignals;
      policyVersion: string;
    } & AttemptMeta)
  | ({ outcome: 'error'; errorCode: ModerateImageErrorCode; policyVersion: string } & AttemptMeta);

/**
 * Uma tentativa de moderação: chama o analisador com timeout, normaliza os sinais (R-3) e aplica
 * a política determinística (R-4). Nunca lança por falha do provedor: devolve `error` com o
 * código (R-5). Não conhece pedidos nem banco.
 */
export class ModerateImage {
  constructor(
    private readonly analyzer: ImageAnalyzer,
    private readonly timeoutMs: number,
  ) {}

  get providerName(): AnalyzerName {
    return this.analyzer.name;
  }

  async execute(
    input: AnalyzeImageInput,
    context: DecisionContext,
  ): Promise<ModerationAttemptResult> {
    const startedAt = Date.now();
    const signal = AbortSignal.timeout(this.timeoutMs);
    let result: AnalyzerResult;
    try {
      result = await this.analyzer.analyze(input, signal);
    } catch (error) {
      const code: ModerateImageErrorCode =
        error instanceof AnalyzerError ? error.code : signal.aborted ? 'timeout' : 'internal';
      return {
        outcome: 'error',
        errorCode: code,
        policyVersion: MODERATION_POLICY_VERSION,
        provider: this.analyzer.name,
        model: null,
        requestId: null,
        latencyMs: Date.now() - startedAt,
      };
    }

    const meta: AttemptMeta = {
      provider: this.analyzer.name,
      model: result.model,
      requestId: result.requestId,
      latencyMs: result.latencyMs,
    };
    const normalized = normalizeSignals(result.raw);
    if (!normalized.ok) {
      return {
        outcome: 'error',
        errorCode: 'invalid_response',
        policyVersion: MODERATION_POLICY_VERSION,
        ...meta,
      };
    }
    const verdict = decide(normalized.value, context);
    if (normalized.truncated.length > 0) {
      verdict.reasons.push(
        `Sinais truncados para a auditoria: ${normalized.truncated.join(', ')}.`,
      );
    }
    return {
      outcome: verdict.outcome,
      verdict,
      signals: normalized.value,
      policyVersion: MODERATION_POLICY_VERSION,
      ...meta,
    };
  }
}
