/** Armazenamento das imagens já reprocessadas (spec sponsorships R-7). */
export interface SponsorImageStorage {
  save(key: string, bytes: Buffer): Promise<void>;
  /** `null` quando o arquivo não existe. */
  read(key: string): Promise<Buffer | null>;
  /** Remover algo inexistente não é erro. */
  remove(key: string): Promise<void>;
}

export const SPONSOR_IMAGE_STORAGE = Symbol('SPONSOR_IMAGE_STORAGE');
