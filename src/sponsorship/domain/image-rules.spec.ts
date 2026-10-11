import { detectImageFormat, dimensionsAllowed } from './image-rules';

const bytes = (...values: (number | string)[]) =>
  Uint8Array.from(
    values.flatMap((v) => (typeof v === 'string' ? [...v].map((c) => c.charCodeAt(0)) : [v])),
  );

describe('regras da imagem — spec sponsorships R-7 (AC-03)', () => {
  it('reconhece PNG, JPEG e WebP pelos bytes mágicos', () => {
    expect(detectImageFormat(bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe('png');
    expect(detectImageFormat(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('jpeg');
    expect(detectImageFormat(bytes('RIFF', 0, 0, 0, 0, 'WEBPVP8 '))).toBe('webp');
  });

  it('recusa SVG, GIF, texto e arquivos curtos', () => {
    expect(detectImageFormat(bytes('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(detectImageFormat(bytes('GIF89a'))).toBeNull();
    expect(detectImageFormat(bytes('isto não é um png'))).toBeNull();
    expect(detectImageFormat(bytes('RIFF', 0, 0, 0, 0, 'WAVE'))).toBeNull();
    expect(detectImageFormat(bytes(0x89))).toBeNull();
  });

  it('aceita dimensões entre 64 e 4096 px', () => {
    expect(dimensionsAllowed(64, 4096)).toBe(true);
    expect(dimensionsAllowed(63, 100)).toBe(false);
    expect(dimensionsAllowed(100, 4097)).toBe(false);
  });
});
