import sharp = require('sharp');
import { SharpImageProcessor } from './sharp-image-processor';

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#ff7a00' } });

describe('SharpImageProcessor — spec sponsorships R-7 (AC-03)', () => {
  const processor = new SharpImageProcessor();

  it('lê as dimensões de PNG e JPEG', async () => {
    expect(await processor.inspect(await solid(300, 120).png().toBuffer())).toEqual({
      width: 300,
      height: 120,
    });
    expect(await processor.inspect(await solid(80, 90).jpeg().toBuffer())).toEqual({
      width: 80,
      height: 90,
    });
  });

  it('devolve null para bytes corrompidos', async () => {
    const png = await solid(100, 100).png().toBuffer();
    expect(await processor.inspect(png.subarray(0, 20))).toBeNull();
  });

  it('gera WebP com maior lado ≤ 1024 px, sem ampliar e sem EXIF', async () => {
    const jpegWithExif = await solid(2000, 1000)
      .jpeg()
      .withMetadata({ exif: { IFD0: { Copyright: 'segredo' } } })
      .toBuffer();
    expect((await sharp(jpegWithExif).metadata()).exif).toBeDefined();

    const out = await processor.toWebp(jpegWithExif, 1024);
    const meta = await sharp(out).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: 1024, height: 512 });
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();

    const small = await processor.toWebp(await solid(200, 100).png().toBuffer(), 1024);
    expect(await sharp(small).metadata()).toMatchObject({ width: 200, height: 100 });
  });
});
