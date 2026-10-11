import type { AnalyzerResult, ImageAnalyzer } from '../../domain/ports/image-analyzer';
import { EMPTY_RAW_SIGNALS } from '../../domain/signals';

export const SIMULATED_DELAY_MS = 1_000;

/**
 * Analisador simulado (spec sponsorship-image-moderation FR-01): devolve sinais vazios após 1 s
 * (a política então aprova), para desenvolvimento sem credenciais. Identificado como `simulated`
 * na auditoria; recusado em produção pela config.
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
      raw: EMPTY_RAW_SIGNALS,
      model: 'simulated',
      requestId: null,
      latencyMs: Date.now() - startedAt,
    };
  }
}
