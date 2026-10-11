import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalDiskImageStorage } from './local-disk-image-storage';

const KEY = '3f0e8a52-6c1e-4f0a-9d3b-2a1b4c5d6e7f.webp';

describe('LocalDiskImageStorage', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sponsor-'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('salva, lê e remove; ausente → null; remover duas vezes não falha', async () => {
    const storage = new LocalDiskImageStorage(join(dir, 'nested'));
    await storage.save(KEY, Buffer.from('abc'));
    expect((await storage.read(KEY))?.toString()).toBe('abc');
    await storage.remove(KEY);
    await storage.remove(KEY);
    expect(await storage.read(KEY)).toBeNull();
  });

  it('recusa chaves fora do padrão (path traversal)', async () => {
    const storage = new LocalDiskImageStorage(dir);
    await expect(storage.read('../../etc/passwd')).rejects.toThrow('chave de imagem inválida');
    await expect(storage.save('x.png', Buffer.from(''))).rejects.toThrow();
  });
});
