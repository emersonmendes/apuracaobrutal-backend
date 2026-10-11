import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { SponsorImageStorage } from '../../domain/ports/sponsor-image-storage';

/** Só chaves geradas pelo backend (`<uuid>.webp`): impede path traversal. */
const KEY = /^[0-9a-f-]{36}\.webp$/;

function assertKey(key: string) {
  if (!KEY.test(key)) throw new Error(`chave de imagem inválida: ${key}`);
}

/** Armazena as imagens reprocessadas numa pasta local/volume (spec sponsorships FR-01). */
export class LocalDiskImageStorage implements SponsorImageStorage {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = resolve(dir);
  }

  async save(key: string, bytes: Buffer): Promise<void> {
    assertKey(key);
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, key), bytes);
  }

  async read(key: string): Promise<Buffer | null> {
    assertKey(key);
    try {
      return await readFile(join(this.dir, key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async remove(key: string): Promise<void> {
    assertKey(key);
    await rm(join(this.dir, key), { force: true });
  }
}
