/** Entrada mínima enviada ao provedor (spec sponsorship-image-moderation R-8): imagem + local. */
export interface AnalyzeImageInput {
  image: Buffer;
  mediaType: 'image/webp';
  /** Descrição em pt-BR do espaço publicitário contratado (ex.: "faixa central do fundo"). */
  placement: string;
}

export type AnalyzerName = 'claude' | 'simulated';

/** Resultado cru de uma chamada; a interpretação é do domínio (R-3, R-4). */
export type AnalyzerResult =
  | {
      kind: 'response';
      /** Texto JSON (ou objeto) devolvido pelo modelo, sem interpretação. */
      raw: unknown;
      model: string;
      requestId: string | null;
      latencyMs: number;
      inputTokens: number | null;
      outputTokens: number | null;
    }
  | {
      kind: 'refusal';
      model: string;
      requestId: string | null;
      latencyMs: number;
    };

/**
 * Porta do provedor de análise de imagens (nível 1). O adapter só traduz protocolo: monta a
 * requisição, classifica falhas em {@link AnalyzerError} e devolve o conteúdo bruto.
 */
export interface ImageAnalyzer {
  readonly name: AnalyzerName;
  analyze(input: AnalyzeImageInput, signal: AbortSignal): Promise<AnalyzerResult>;
}

export const IMAGE_ANALYZER = Symbol('IMAGE_ANALYZER');
