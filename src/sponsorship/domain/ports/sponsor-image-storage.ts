/**
 * Armazenamento das imagens já reprocessadas (spec sponsorships R-7). Contrato comum a todos os
 * adapters (sponsorship-s3-storage R-3): falha de infraestrutura lança `StorageError`
 * (`domain/errors.ts`); "não existe" nunca é erro.
 */
export interface SponsorImageStorage {
  /** Grava ou sobrescreve; repetir com os mesmos bytes é idempotente. */
  save(key: string, bytes: Buffer): Promise<void>;
  /** `null` quando o objeto não existe (ou, no S3, excede o tamanho máximo de uma imagem). */
  read(key: string): Promise<Buffer | null>;
  /** Remover algo inexistente não é erro. */
  remove(key: string): Promise<void>;
}

export const SPONSOR_IMAGE_STORAGE = Symbol('SPONSOR_IMAGE_STORAGE');
