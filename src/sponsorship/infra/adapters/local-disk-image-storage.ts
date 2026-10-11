import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { StorageError, type StorageOperation } from '../../domain/errors';
import type { SponsorImageStorage } from '../../domain/ports/sponsor-image-storage';
import { assertImageKey } from './image-key';

/**
 * Armazena as imagens reprocessadas numa pasta local/volume (spec sponsorships FR-01). Só com
 * `SPONSORSHIP_STORAGE=local` (sponsorship-s3-storage R-1); erros de disco que não sejam
 * `ENOENT` viram `StorageError` (R-3).
 */
export class LocalDiskImageStorage implements SponsorImageStorage {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = resolve(dir);
  }

  async save(key: string, bytes: Buffer): Promise<void> {
    assertImageKey(key);
    try {
      await mkdir(this.dir, { recursive: true });
      await writeFile(join(this.dir, key), bytes);
    } catch (error) {
      throw toStorageError('save', key, error);
    }
  }

  async read(key: string): Promise<Buffer | null> {
    assertImageKey(key);
    try {
      return await readFile(join(this.dir, key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw toStorageError('read', key, error);
    }
  }

  async remove(key: string): Promise<void> {
    assertImageKey(key);
    try {
      await rm(join(this.dir, key), { force: true });
    } catch (error) {
      throw toStorageError('remove', key, error);
    }
  }
}

function toStorageError(operation: StorageOperation, key: string, error: unknown): StorageError {
  const { code, name } = (error ?? {}) as NodeJS.ErrnoException;
  return new StorageError(operation, key, { name: code ?? name ?? null });
}
