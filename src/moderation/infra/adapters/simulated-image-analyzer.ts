import { MODERATION_POLICY_VERSION } from '../../domain/contract';
import type { AnalyzerResult, ImageAnalyzer } from '../../domain/ports/image-analyzer';

export const SIMULATED_DELAY_MS = 1_000;

/**
 * Analisador simulado (spec sponsorship-image-moderation FR-01): aprova tudo após 1 s, para
 * desenvolvimento sem chave. Identificado como `simulated` na auditoria; recusado em produção
 * pela config.
 */
export class SimulatedImageAnalyzer implements ImageAnalyzer {
  readonly name = 'simulated' as const;

  constructor(private readonly delayMs = SIMULATED_DELAY_MS) {}

  async analyze(_input: unknown, signal: AbortSignal): Promise<AnalyzerResult> {
    const startedAt = Date.now();
    await new Promise<void>((resolve) => {
      if (signal.aborted) return resolve();
      const timer = setTimeout(done, this.delayMs);
      function done() {
        clearTimeout(timer);
        signal.removeEventListener('abort', done);
        resolve();
      }
      signal.addEventListener('abort', done);
    });
    return {
      kind: 'response',
      raw: {
        decision: 'APPROVE',
        categories: [],
        detected_text: [],
        reasons: [
          'Análise simulada (desenvolvimento): aprovação automática sem leitura da imagem.',
        ],
        confidence: 1,
        policy_version: MODERATION_POLICY_VERSION,
      },
      model: 'simulated',
      requestId: null,
      latencyMs: Date.now() - startedAt,
      inputTokens: null,
      outputTokens: null,
    };
  }
}
