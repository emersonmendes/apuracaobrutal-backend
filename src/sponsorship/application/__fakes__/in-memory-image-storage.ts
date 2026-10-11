import type { SponsorImageStorage } from '../../domain/ports/sponsor-image-storage';

export class InMemoryImageStorage implements SponsorImageStorage {
  readonly files = new Map<string, Buffer>();
  failingKeys = new Set<string>();

  async save(key: string, bytes: Buffer): Promise<void> {
    this.files.set(key, bytes);
  }

  async read(key: string): Promise<Buffer | null> {
    return this.files.get(key) ?? null;
  }

  async remove(key: string): Promise<void> {
    if (this.failingKeys.has(key)) throw new Error(`falha ao remover ${key}`);
    this.files.delete(key);
  }
}
