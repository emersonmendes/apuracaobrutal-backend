/**
 * Só chaves geradas pelo backend (`<uuid>.webp`) chegam ao armazenamento (spec sponsorships
 * FR-04; sponsorship-s3-storage R-2): impede path traversal no disco e chaves arbitrárias no S3.
 */
const KEY = /^[0-9a-f-]{36}\.webp$/;

export function assertImageKey(key: string): void {
  if (!KEY.test(key)) throw new Error(`chave de imagem inválida: ${key}`);
}
