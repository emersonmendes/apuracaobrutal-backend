import {
  MODERATION_POLICY_VERSION,
  parseModerationResponse,
  type ModerationResponse,
} from '../domain/contract';
import { AnalyzerError, type AnalyzerErrorCode } from '../domain/errors';
import { decide, type DecisionContext, type Verdict } from '../domain/policy';
import type {
  AnalyzeImageInput,
  AnalyzerName,
  AnalyzerResult,
  ImageAnalyzer,
} from '../domain/ports/image-analyzer';

export type ModerateImageErrorCode = AnalyzerErrorCode | 'invalid_response';

interface AttemptMeta {
  provider: AnalyzerName;
  model: string | null;
  requestId: string | null;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
}

/** Resultado de **uma** tentativa (spec sponsorship-image-moderation FR-04, R-5). */
export type ModerationAttemptResult =
  | ({
      outcome: 'approved' | 'rejected';
      verdict: Verdict;
      response: ModerationResponse | null;
      policyVersion: string;
    } & AttemptMeta)
  | ({ outcome: 'error'; errorCode: ModerateImageErrorCode; policyVersion: string } & AttemptMeta);

/**
 * Uma tentativa de moderação: chama o analisador com timeout, valida o contrato (R-3) e aplica a
 * política determinística (R-4). Nunca lança por falha do provedor: devolve `error` com o código
 * (R-5). Não conhece pedidos nem banco.
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
        inputTokens: null,
        outputTokens: null,
      };
    }

    const meta: AttemptMeta = {
      provider: this.analyzer.name,
      model: result.model,
      requestId: result.requestId,
      latencyMs: result.latencyMs,
      inputTokens: result.kind === 'response' ? result.inputTokens : null,
      outputTokens: result.kind === 'response' ? result.outputTokens : null,
    };
    if (result.kind === 'refusal') {
      const verdict = decide({ kind: 'refusal' }, context);
      return {
        outcome: verdict.outcome,
        verdict,
        response: null,
        policyVersion: MODERATION_POLICY_VERSION,
        ...meta,
      };
    }
    const parsed = parseModerationResponse(result.raw);
    if (!parsed.ok) {
      return {
        outcome: 'error',
        errorCode: 'invalid_response',
        policyVersion: MODERATION_POLICY_VERSION,
        ...meta,
      };
    }
    const verdict = decide({ kind: 'response', response: parsed.value }, context);
    return {
      outcome: verdict.outcome,
      verdict,
      response: parsed.value,
      policyVersion: MODERATION_POLICY_VERSION,
      ...meta,
    };
  }
}
