// Porta da fonte de resultados (spec election-results-feed FR-02). O adapter só traduz protocolo.
import type { Scope } from '../election-config';

export type FetchScopeResult =
  | { kind: 'ok'; body: string; etag: string | null }
  | { kind: 'not_modified' }
  | { kind: 'not_found' }
  | { kind: 'blocked' }
  | { kind: 'error'; reason: string };

export interface ResultsSource {
  /** Baixa o arquivo EA20 assinado (`.jws`) do escopo. */
  fetchScope(scope: Scope, etag: string | null): Promise<FetchScopeResult>;
}

export const RESULTS_SOURCE = Symbol('RESULTS_SOURCE');
