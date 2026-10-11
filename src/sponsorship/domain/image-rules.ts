/** Regras da imagem enviada (spec sponsorships R-7; sponsorship-image-moderation R-6). */
import { createHash } from 'node:crypto';
export type ImageFormat = 'png' | 'jpeg' | 'webp';

export const MIN_SIDE_PX = 64;
export const MAX_SIDE_PX = 4096;
export const OUTPUT_MAX_SIDE_PX = 1024;

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  bytes.length >= offset + signature.length &&
  signature.every((byte, i) => bytes[offset + i] === byte);

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

/** Formato pelos bytes mágicos; extensão e Content-Type do cliente são ignorados. */
export function detectImageFormat(bytes: Uint8Array): ImageFormat | null {
  if (startsWith(bytes, PNG)) return 'png';
  if (startsWith(bytes, JPEG)) return 'jpeg';
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'webp';
  return null;
}

/** SHA-256 em hex: identidade da imagem analisada e publicada (sponsorship-image-moderation R-6). */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Dimensões decodificadas dentro de 64…4096 px em cada lado. */
export function dimensionsAllowed(width: number, height: number): boolean {
  return [width, height].every(
    (side) => Number.isInteger(side) && side >= MIN_SIDE_PX && side <= MAX_SIDE_PX,
  );
}
