/** Número máximo de proxies confiáveis aceito em `TRUST_PROXY`. */
export const MAX_TRUST_PROXY = 10;

/**
 * Lê `TRUST_PROXY`: número exato de proxies reversos entre o cliente e o backend (padrão 0).
 * Só inteiros de 0 a 10; qualquer outro valor (inclusive `true`/`*`) falha a subida, para nunca
 * confiar em um `X-Forwarded-For` forjável. Spec: /specs/backend-bootstrap (FR-03, R-9).
 */
export function parseTrustProxy(raw: string | undefined): number {
  const value = raw?.trim() ?? '';
  if (value === '') return 0;
  if (!/^\d+$/.test(value) || Number(value) > MAX_TRUST_PROXY) {
    throw new Error(`TRUST_PROXY inválido: use um inteiro de 0 a ${MAX_TRUST_PROXY}.`);
  }
  return Number(value);
}
