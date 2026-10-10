// Fake em memória da porta ElectionRepository, para testes de aplicação e e2e. Imita as chaves
// únicas do Prisma (generationId por escopo; dedupeKey por eleição).
import { randomUUID } from 'node:crypto';
import { isTerminalCombat, type StoredCombatEvent } from '../../domain/combat-events';
import type { Scope } from '../../domain/election-config';
import type { StoredElectionEvent } from '../../domain/election-events';
import type {
  AcceptedResult,
  ElectionRepository,
  ScopeSourceStateRecord,
  SourceStatusRecord,
} from '../../domain/ports/election-repository';
import type { ScopeResult, StoredScopeResult } from '../../domain/scope-result';

interface EventRow extends StoredElectionEvent {
  electionCode: string;
  dedupeKey: string;
  seq: number;
}

interface CombatRow extends StoredCombatEvent {
  electionCode: string;
  dedupeKey: string;
  seq: number;
}

const emptyState = (): ScopeSourceStateRecord => ({
  lastGeneratedAt: null,
  lastEtag: null,
  lastSeenAt: null,
  notFoundUntil: null,
});

export class InMemoryElectionRepository implements ElectionRepository {
  results: Array<StoredScopeResult & { etag: string | null }> = [];
  events: EventRow[] = [];
  combatEvents: CombatRow[] = [];
  scopeStates = new Map<Scope, ScopeSourceStateRecord>();
  status: SourceStatusRecord | null = null;
  /** Faz a próxima gravação de evento falhar (simula erro no meio da transação). */
  failNextEventInsert = false;
  private seq = 0;

  async getSourceStatus(): Promise<SourceStatusRecord | null> {
    return this.status ? { ...this.status } : null;
  }

  async getScopeStates(): Promise<Map<Scope, ScopeSourceStateRecord>> {
    return new Map([...this.scopeStates].map(([k, v]) => [k, { ...v }]));
  }

  async getLatestScopeResults(): Promise<Map<Scope, StoredScopeResult>> {
    const latest = new Map<Scope, StoredScopeResult>();
    for (const row of this.results) latest.set(row.result.scope, row);
    return latest;
  }

  async getBrHistory(_code: string, limit: number): Promise<ScopeResult[]> {
    return this.results
      .filter((r) => r.result.scope === 'br')
      .slice(-limit)
      .map((r) => r.result);
  }

  async getRecentEvents(_code: string, limit: number): Promise<StoredElectionEvent[]> {
    return [...this.events]
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || b.seq - a.seq)
      .slice(0, limit)
      .map(({ id, occurredAt, text, side }) => ({ id, occurredAt, text, side }));
  }

  async getRecentCombatEvents(_code: string, limit: number): Promise<StoredCombatEvent[]> {
    return [...this.combatEvents]
      .sort((a, b) => a.seq - b.seq)
      .slice(-limit)
      .map(({ id, occurredAt, red, blue }) => ({ id, occurredAt, red, blue }));
  }

  async getLatestTerminalCombatEvent(): Promise<StoredCombatEvent | null> {
    const terminals = [...this.combatEvents].sort((a, b) => a.seq - b.seq).filter(isTerminalCombat);
    const terminal = terminals[terminals.length - 1];
    return terminal
      ? { id: terminal.id, occurredAt: terminal.occurredAt, red: terminal.red, blue: terminal.blue }
      : null;
  }

  async saveAcceptedResult(accepted: AcceptedResult): Promise<void> {
    const { result } = accepted;
    const exists = this.results.some(
      (r) => r.result.scope === result.scope && r.result.generationId === result.generationId,
    );
    if (exists) return;

    // "Transação": monta tudo antes e só aplica no fim.
    const newEvents: EventRow[] = [];
    for (const event of accepted.events) {
      if (this.failNextEventInsert) {
        this.failNextEventInsert = false;
        throw new Error('falha simulada ao gravar evento');
      }
      const duplicate = [...this.events, ...newEvents].some(
        (e) => e.electionCode === result.electionCode && e.dedupeKey === event.dedupeKey,
      );
      if (duplicate) continue;
      newEvents.push({
        id: randomUUID(),
        electionCode: result.electionCode,
        dedupeKey: event.dedupeKey,
        occurredAt: event.occurredAt,
        text: event.text,
        side: event.side,
        seq: ++this.seq,
      });
    }

    const combat = accepted.combatEvent;
    const newCombat: CombatRow[] =
      combat &&
      !this.combatEvents.some(
        (e) => e.electionCode === result.electionCode && e.dedupeKey === combat.dedupeKey,
      )
        ? [
            {
              id: randomUUID(),
              electionCode: result.electionCode,
              dedupeKey: combat.dedupeKey,
              occurredAt: combat.occurredAt,
              red: combat.red,
              blue: combat.blue,
              seq: ++this.seq,
            },
          ]
        : [];

    this.results.push({ result, contentHash: accepted.contentHash, etag: accepted.etag });
    this.events.push(...newEvents);
    this.combatEvents.push(...newCombat);
    this.scopeStates.set(result.scope, {
      lastGeneratedAt: result.generatedAt,
      lastEtag: accepted.etag,
      lastSeenAt: accepted.receivedAt,
      notFoundUntil: null,
    });
    this.status = { ...this.ensureStatus(), feedVersion: this.ensureStatus().feedVersion + 1 };
  }

  async touchScope(
    _code: string,
    scope: Scope,
    update: { seenAt: Date; generatedAt?: Date; etag?: string | null },
  ): Promise<void> {
    const state = this.scopeStates.get(scope) ?? emptyState();
    this.scopeStates.set(scope, {
      ...state,
      lastSeenAt: update.seenAt,
      notFoundUntil: null,
      ...(update.generatedAt !== undefined && { lastGeneratedAt: update.generatedAt }),
      ...(update.etag !== undefined && { lastEtag: update.etag }),
    });
  }

  async markNotFound(_code: string, scope: Scope, until: Date): Promise<void> {
    this.scopeStates.set(scope, {
      ...(this.scopeStates.get(scope) ?? emptyState()),
      notFoundUntil: until,
    });
  }

  async markBlocked(_code: string, until: Date): Promise<void> {
    this.status = { ...this.ensureStatus(), blockedUntil: until };
  }

  async recordCycle(
    _code: string,
    cycle: { attemptAt: Date; success: boolean; error: string | null },
  ): Promise<void> {
    const status = this.ensureStatus();
    this.status = {
      ...status,
      lastAttemptAt: cycle.attemptAt,
      lastError: cycle.error,
      lastSuccessAt: cycle.success ? cycle.attemptAt : status.lastSuccessAt,
    };
  }

  private ensureStatus(): SourceStatusRecord {
    return (
      this.status ?? {
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastError: null,
        blockedUntil: null,
        feedVersion: 0,
      }
    );
  }
}
