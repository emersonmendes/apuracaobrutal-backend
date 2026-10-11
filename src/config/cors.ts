import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/** Origem do `web` local. Spec: /specs/backend-bootstrap (FR-05). */
export const DEFAULT_CORS_ORIGIN = 'http://localhost:3100';

/**
 * Converte `CORS_ORIGINS` (lista separada por vírgula) na allow-list de origens.
 * Remove espaços, ignora entradas vazias e `*`; sem nenhuma origem válida, usa o padrão.
 *
 * Spec: /specs/backend-bootstrap (FR-05, R-6).
 */
export function parseCorsOrigins(raw: string | undefined): string[] {
  const origins = (raw ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '' && origin !== '*');

  return origins.length > 0 ? origins : [DEFAULT_CORS_ORIGIN];
}

/**
 * Opções de CORS: só origens da allow-list recebem headers, sem credenciais e apenas os métodos
 * usados (`POST` desde a spec sponsorships FR-03). Spec: /specs/backend-bootstrap (FR-05, R-6).
 */
export function buildCorsOptions(origins: string[]): CorsOptions {
  return {
    origin: origins,
    credentials: false,
    methods: ['GET', 'HEAD', 'OPTIONS', 'POST'],
  };
}
