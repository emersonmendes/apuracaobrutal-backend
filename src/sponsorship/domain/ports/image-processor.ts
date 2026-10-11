/** Decodificação/reprocessamento de imagem (spec sponsorships R-7). */
export interface ImageProcessor {
  /** Dimensões lidas do cabeçalho; `null` se não decodifica. */
  inspect(bytes: Buffer): Promise<{ width: number; height: number } | null>;
  /** WebP, maior lado ≤ `maxSide` (sem ampliar), sem metadados, só o primeiro quadro. */
  toWebp(bytes: Buffer, maxSide: number): Promise<Buffer>;
}

export const IMAGE_PROCESSOR = Symbol('IMAGE_PROCESSOR');
