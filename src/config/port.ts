/** Porta padrão do backend. Spec: /specs/backend-bootstrap (FR-03), dev-environment (R-2). */
export const DEFAULT_PORT = 3433;

/**
 * Porta HTTP: `PORT` quando definida, senão o padrão.
 * Spec: /specs/backend-bootstrap (FR-03, R-4).
 */
export function resolvePort(raw: string | undefined): string | number {
  return raw !== undefined && raw.trim() !== '' ? raw.trim() : DEFAULT_PORT;
}
