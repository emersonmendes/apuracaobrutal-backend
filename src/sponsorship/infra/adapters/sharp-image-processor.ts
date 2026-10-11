import sharp = require('sharp');
import { MAX_SIDE_PX } from '../../domain/image-rules';
import type { ImageProcessor } from '../../domain/ports/image-processor';

/** Recusa antes de decodificar por inteiro qualquer imagem acima de 4096 × 4096 (R-7). */
const LIMIT_INPUT_PIXELS = MAX_SIDE_PX * MAX_SIDE_PX;

/** Decodificação e reprocessamento com sharp (spec sponsorships R-7). */
export class SharpImageProcessor implements ImageProcessor {
  async inspect(bytes: Buffer): Promise<{ width: number; height: number } | null> {
    try {
      const { width, height } = await sharp(bytes, {
        limitInputPixels: LIMIT_INPUT_PIXELS,
      }).metadata();
      return width && height ? { width, height } : null;
    } catch {
      return null;
    }
  }

  /** WebP sem metadados (sharp descarta EXIF/ICC/XMP por padrão), só o 1º quadro, sem ampliar. */
  async toWebp(bytes: Buffer, maxSide: number): Promise<Buffer> {
    return sharp(bytes, { pages: 1, limitInputPixels: LIMIT_INPUT_PIXELS, failOn: 'error' })
      .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
  }
}
