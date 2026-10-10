import { paddedElectionCode, type ElectionConfig, type Scope } from '../../domain/election-config';
import type { FetchScopeResult, ResultsSource } from '../../domain/ports/results-source';

export const TSE_TIMEOUT_MS = 10_000;
export const TSE_MAX_BODY_BYTES = 2 * 1024 * 1024;

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

/** URL do arquivo EA20 assinado de Presidente (`c0001`) do escopo (FR-02). */
export function scopeFileUrl(config: ElectionConfig, scope: Scope): string {
  const code = config.electionCode;
  return (
    `${config.resultsUrl}/${config.cycle}/${code}/dados/${scope}/` +
    `${scope}-c0001-e${paddedElectionCode(code)}-u.jws`
  );
}

async function readLimited(response: Response, maxBytes: number): Promise<string | null> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Adapter HTTP da fonte TSE (spec election-results-feed FR-02, R-11). Só traduz protocolo: não
 * verifica, não valida e não interpreta o conteúdo.
 */
export class TseResultsSource implements ResultsSource {
  constructor(
    private readonly config: ElectionConfig,
    private readonly userAgent: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async fetchScope(scope: Scope, etag: string | null): Promise<FetchScopeResult> {
    const headers: Record<string, string> = { 'User-Agent': this.userAgent };
    if (etag) headers['If-None-Match'] = etag;

    let response: Response;
    try {
      response = await this.fetchFn(scopeFileUrl(this.config, scope), {
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(TSE_TIMEOUT_MS),
      });
    } catch (error) {
      return { kind: 'error', reason: `falha de rede: ${(error as Error).message}` };
    }

    switch (response.status) {
      case 200: {
        let body: string | null;
        try {
          body = await readLimited(response, TSE_MAX_BODY_BYTES);
        } catch (error) {
          return { kind: 'error', reason: `falha ao ler corpo: ${(error as Error).message}` };
        }
        if (body === null) return { kind: 'error', reason: 'corpo acima de 2 MB' };
        return { kind: 'ok', body, etag: response.headers.get('etag') };
      }
      case 304:
        return { kind: 'not_modified' };
      case 404:
        return { kind: 'not_found' };
      case 403:
      case 429:
        return { kind: 'blocked' };
      default:
        await response.body?.cancel().catch(() => undefined);
        return { kind: 'error', reason: `HTTP ${response.status}` };
    }
  }
}
