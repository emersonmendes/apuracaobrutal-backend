/** Falhas técnicas do analisador (spec sponsorship-image-moderation R-5). */
export type AnalyzerErrorCode =
  'timeout' | 'rate_limited' | 'provider_unavailable' | 'provider_rejected' | 'internal';

/**
 * Falha ao falar com o provedor de análise. A mensagem nunca carrega a chave de API, o prompt
 * nem a imagem (R-8).
 */
export class AnalyzerError extends Error {
  constructor(
    readonly code: AnalyzerErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = 'AnalyzerError';
  }
}
