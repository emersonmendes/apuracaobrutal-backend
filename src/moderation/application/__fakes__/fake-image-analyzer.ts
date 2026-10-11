import { AnalyzerError, type AnalyzerErrorCode } from '../../domain/errors';
import type {
  AnalyzeImageInput,
  AnalyzerName,
  AnalyzerResult,
  ImageAnalyzer,
} from '../../domain/ports/image-analyzer';

type Scripted =
  | { kind: 'response'; raw: unknown }
  | { kind: 'refusal' }
  | { kind: 'error'; code: AnalyzerErrorCode }
  | { kind: 'hang' };

/** Analisador falso: respostas roteirizadas em fila, registro das chamadas, atraso opcional. */
export class FakeImageAnalyzer implements ImageAnalyzer {
  readonly calls: AnalyzeImageInput[] = [];
  readonly queue: Scripted[] = [];
  delayMs = 0;
  model = 'fake-model';

  constructor(readonly name: AnalyzerName = 'claude') {}

  respond(raw: unknown) {
    this.queue.push({ kind: 'response', raw });
    return this;
  }

  refuse() {
    this.queue.push({ kind: 'refusal' });
    return this;
  }

  fail(code: AnalyzerErrorCode) {
    this.queue.push({ kind: 'error', code });
    return this;
  }

  /** Nunca responde: só o timeout do chamador encerra. */
  hang() {
    this.queue.push({ kind: 'hang' });
    return this;
  }

  async analyze(input: AnalyzeImageInput, signal: AbortSignal): Promise<AnalyzerResult> {
    this.calls.push(input);
    const next = this.queue.shift() ?? { kind: 'error', code: 'internal' };
    if (next.kind === 'hang') {
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
      throw new AnalyzerError('timeout');
    }
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if (next.kind === 'error') throw new AnalyzerError(next.code);
    const meta = { model: this.model, requestId: `req_${this.calls.length}`, latencyMs: 5 };
    if (next.kind === 'refusal') return { kind: 'refusal', ...meta };
    return { kind: 'response', raw: next.raw, inputTokens: 1500, outputTokens: 120, ...meta };
  }
}
