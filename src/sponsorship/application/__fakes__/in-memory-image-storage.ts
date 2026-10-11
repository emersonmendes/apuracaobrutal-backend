import { StorageError, type StorageOperation } from '../../domain/errors';
import type { SponsorImageStorage } from '../../domain/ports/sponsor-image-storage';

export class InMemoryImageStorage implements SponsorImageStorage {
  readonly files = new Map<string, Buffer>();
  failingKeys = new Set<string>();
  /** Próxima chamada dessa operação lança `StorageError` (sponsorship-s3-storage R-3). */
  failNext: StorageOperation | null = null;

  async save(key: string, bytes: Buffer): Promise<void> {
    this.maybeFail('save', key);
    this.files.set(key, bytes);
  }

  async read(key: string): Promise<Buffer | null> {
    this.maybeFail('read', key);
    return this.files.get(key) ?? null;
  }

  async remove(key: string): Promise<void> {
    this.maybeFail('remove', key);
    if (this.failingKeys.has(key)) throw new Error(`falha ao remover ${key}`);
    this.files.delete(key);
  }

  private maybeFail(operation: StorageOperation, key: string) {
    if (this.failNext !== operation) return;
    this.failNext = null;
    throw new StorageError(operation, key, { name: 'AccessDenied', status: 403 });
  }
}
