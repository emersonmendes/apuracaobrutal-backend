import { AnalyzerError, type AnalyzerErrorCode } from '../../domain/errors';
import type {
  AnalyzeImageInput,
  AnalyzerName,
  AnalyzerResult,
  ImageAnalyzer,
} from '../../domain/ports/image-analyzer';
import { EMPTY_RAW_SIGNALS } from '../../domain/signals';

type Scripted =
  { kind: 'raw'; raw: unknown } | { kind: 'error'; code: AnalyzerErrorCode } | { kind: 'hang' };

/** Rótulo cru no formato do provedor, para montar respostas de teste. */
export const rawLabel = (
  Name: string,
  Confidence: number,
  ParentName?: string,
  TaxonomyLevel?: number,
) => ({ Name, Confidence, ParentName, TaxonomyLevel: TaxonomyLevel ?? (ParentName ? 2 : 1) });

/** Linha de texto crua (`LINE`) com suas palavras (`WORD`). */
export const rawLine = (text: string, confidence = 99) => [
  { DetectedText: text, Type: 'LINE', Confidence: confidence, Id: 0 },
  ...text.split(/\s+/).map((word, index) => ({
    DetectedText: word,
    Type: 'WORD',
    Confidence: confidence,
    Id: index + 1,
    ParentId: 0,
  })),
];

export const rawCelebrity = (Name: string, MatchConfidence: number, Id = 'id') => ({
  Name,
  Id,
  MatchConfidence,
});

/** Monta a resposta crua das três operações a partir de partes opcionais. */
export function rawSignals(
  parts: {
    labels?: ReturnType<typeof rawLabel>[];
    lines?: string[];
    wordCount?: number;
    celebrities?: ReturnType<typeof rawCelebrity>[];
    contentTypes?: { Name: string; Confidence: number }[];
  } = {},
) {
  const detections = (parts.lines ?? []).flatMap((line) => rawLine(line));
  if (parts.wordCount !== undefined) {
    const words = detections.filter((d) => d.Type === 'WORD').length;
    for (let i = words; i < parts.wordCount; i += 1) {
      detections.push({
        DetectedText: `w${i}`,
        Type: 'WORD',
        Confidence: 90,
        Id: 1000 + i,
        ParentId: 0,
      });
    }
  }
  return {
    moderation: {
      ModerationLabels: parts.labels ?? [],
      ContentTypes: parts.contentTypes ?? [],
      ModerationModelVersion: '7.0',
    },
    text: { TextDetections: detections, TextModelVersion: '3.0' },
    celebrities: { CelebrityFaces: parts.celebrities ?? [] },
  };
}

/** Analisador falso: respostas roteirizadas em fila, registro das chamadas, atraso opcional. */
export class FakeImageAnalyzer implements ImageAnalyzer {
  readonly calls: AnalyzeImageInput[] = [];
  readonly queue: Scripted[] = [];
  delayMs = 0;
  model = 'fake-model';

  constructor(readonly name: AnalyzerName = 'rekognition') {}

  /** Resposta crua (forma do provedor). */
  respond(raw: unknown) {
    this.queue.push({ kind: 'raw', raw });
    return this;
  }

  /** Resposta sem rótulos, texto nem rostos. */
  respondEmpty() {
    return this.respond(EMPTY_RAW_SIGNALS);
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
    return {
      raw: next.raw,
      model: this.model,
      requestId: `req_${this.calls.length}`,
      latencyMs: 5,
    };
  }
}
