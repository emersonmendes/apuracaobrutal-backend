/** Entrada enviada ao provedor (spec sponsorship-image-moderation R-8): só a imagem. */
export interface AnalyzeImageInput {
  image: Buffer;
  mediaType: 'image/webp';
}

export type AnalyzerName = 'rekognition' | 'simulated';

/** Resultado cru de uma tentativa; a normalização e a decisão são do domínio (R-3, R-4). */
export interface AnalyzerResult {
  /** Respostas do provedor como devolvidas (sem metadados de transporte), sem interpretação. */
  raw: unknown;
  /** Versões dos modelos do provedor (ex.: `moderation=7.0;text=3.0`). */
  model: string;
  requestId: string | null;
  latencyMs: number;
}

/**
 * Porta do provedor de análise de imagens (nível 1). O adapter só traduz protocolo: converte o
 * formato, chama o provedor, classifica falhas em {@link AnalyzerError} e devolve o conteúdo bruto.
 */
export interface ImageAnalyzer {
  readonly name: AnalyzerName;
  analyze(input: AnalyzeImageInput, signal: AbortSignal): Promise<AnalyzerResult>;
}

export const IMAGE_ANALYZER = Symbol('IMAGE_ANALYZER');
