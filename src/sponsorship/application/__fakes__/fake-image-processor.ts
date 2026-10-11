import type { ImageProcessor } from '../../domain/ports/image-processor';

/** Devolve dimensões fixas e um "WebP" marcado, sem decodificar nada. */
export class FakeImageProcessor implements ImageProcessor {
  size: { width: number; height: number } | null = { width: 800, height: 400 };

  async inspect(): Promise<{ width: number; height: number } | null> {
    return this.size;
  }

  async toWebp(bytes: Buffer): Promise<Buffer> {
    return Buffer.concat([Buffer.from('WEBP:'), bytes.subarray(0, 8)]);
  }
}
