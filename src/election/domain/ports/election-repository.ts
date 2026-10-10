// Porta de persistência do módulo election (spec election-results-feed FR-05; Fluxos 1–4).
import type { NewCombatEvent, StoredCombatEvent } from '../combat-events';
import type { Scope } from '../election-config';
import type { NewElectionEvent, StoredElectionEvent } from '../election-events';
import type { ScopeResult, StoredScopeResult } from '../scope-result';

export interface SourceStatusRecord {
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  blockedUntil: Date | null;
  feedVersion: number;
}

export interface ScopeSourceStateRecord {
  lastGeneratedAt: Date | null;
  lastEtag: string | null;
  lastSeenAt: Date | null;
  notFoundUntil: Date | null;
}

export interface AcceptedResult {
  result: ScopeResult;
  contentHash: string;
  etag: string | null;
  rawPayload: unknown;
  receivedAt: Date;
  events: NewElectionEvent[];
  /** No máximo um golpe por arquivo (combat-events R-4). */
  combatEvent: NewCombatEvent | null;
}

export interface ElectionRepository {
  getSourceStatus(electionCode: string): Promise<SourceStatusRecord | null>;
  getScopeStates(electionCode: string): Promise<Map<Scope, ScopeSourceStateRecord>>;
  /** Último resultado gravado de cada escopo. */
  getLatestScopeResults(electionCode: string): Promise<Map<Scope, StoredScopeResult>>;
  /** Histórico do `br` (mais antigo primeiro), limitado aos `limit` mais recentes. */
  getBrHistory(electionCode: string, limit: number): Promise<ScopeResult[]>;
  /** Eventos mais recentes (`occurredAt` desc, depois o gerado por último primeiro). */
  getRecentEvents(electionCode: string, limit: number): Promise<StoredElectionEvent[]>;
  /** Golpes de maior `seq`, devolvidos em `seq` crescente (combat-events FR-03). */
  getRecentCombatEvents(electionCode: string, limit: number): Promise<StoredCombatEvent[]>;
  /** Golpe terminal (`victory`/`defeat`) de maior `seq`, ou `null`. */
  getLatestTerminalCombatEvent(electionCode: string): Promise<StoredCombatEvent | null>;

  /**
   * Transação (FR-05): resultado + candidatos + eventos + golpe + estado do escopo + `feedVersion`.
   * Mesmo `generationId` ou `dedupeKey` já gravados são ignorados sem erro.
   */
  saveAcceptedResult(accepted: AcceptedResult): Promise<void>;
  /** Arquivo sem mudança (R-7) ou `304`: atualiza só o estado do escopo. */
  touchScope(
    electionCode: string,
    scope: Scope,
    update: { seenAt: Date; generatedAt?: Date; etag?: string | null },
  ): Promise<void>;
  markNotFound(electionCode: string, scope: Scope, until: Date): Promise<void>;
  markBlocked(electionCode: string, until: Date): Promise<void>;
  recordCycle(
    electionCode: string,
    cycle: { attemptAt: Date; success: boolean; error: string | null },
  ): Promise<void>;
}

export const ELECTION_REPOSITORY = Symbol('ELECTION_REPOSITORY');
