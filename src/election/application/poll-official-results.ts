// Ciclo do worker (spec election-results-feed FR-03; Fluxos 1–3). Classe pura, sem framework.
import { toCombatEvent } from '../domain/combat-events';
import { contentHash } from '../domain/content-hash';
import { ALL_SCOPES, type ElectionConfig, type Scope } from '../domain/election-config';
import { generateEvents } from '../domain/election-events';
import { verifyJws } from '../domain/jws';
import type { Clock } from '../domain/ports/clock';
import type {
  ElectionRepository,
  ScopeSourceStateRecord,
} from '../domain/ports/election-repository';
import type { ResultsSource } from '../domain/ports/results-source';
import {
  isBlocked,
  MAX_CONCURRENT_REQUESTS,
  nextBlockedUntil,
  nextNotFoundUntil,
  scopesToRequest,
} from '../domain/request-policy';
import { decideAcceptance } from '../domain/scope-acceptance';
import type { StoredScopeResult } from '../domain/scope-result';
import { validatePayload } from '../domain/validate-payload';

export interface PollLogger {
  log(message: string): void;
  warn(message: string): void;
}

export type ScopeOutcome =
  | { scope: Scope; kind: 'accepted' | 'unchanged' | 'not_modified' | 'stale' }
  | { scope: Scope; kind: 'failed'; reason: string };

export interface CycleSummary {
  blocked: boolean;
  outcomes: ScopeOutcome[];
  brSuccess: boolean;
}

const SUCCESS_KINDS = new Set(['accepted', 'unchanged', 'not_modified', 'stale']);

export class PollOfficialResults {
  constructor(
    private readonly source: ResultsSource,
    private readonly repository: ElectionRepository,
    private readonly clock: Clock,
    private readonly config: ElectionConfig,
    private readonly logger: PollLogger,
  ) {}

  /** Executa um ciclo completo: `br` + 27 UFs, com no máximo 4 requisições simultâneas. */
  async runCycle(): Promise<CycleSummary> {
    const code = this.config.electionCode;
    const attemptAt = this.clock.now();
    const status = await this.repository.getSourceStatus(code);

    if (isBlocked(status?.blockedUntil ?? null, attemptAt)) {
      const error = `bloqueado pelo TSE até ${status!.blockedUntil!.toISOString()}`;
      await this.repository.recordCycle(code, { attemptAt, success: false, error });
      this.logger.warn(`ciclo ignorado: ${error}`);
      return { blocked: true, outcomes: [], brSuccess: false };
    }

    const states = await this.repository.getScopeStates(code);
    const latest = await this.repository.getLatestScopeResults(code);
    const scopes = scopesToRequest(
      ALL_SCOPES,
      (scope) => states.get(scope)?.notFoundUntil ?? null,
      attemptAt,
    );

    let blocked = false;
    const outcomes: ScopeOutcome[] = [];
    const queue = [...scopes];
    const worker = async () => {
      for (let scope = queue.shift(); scope !== undefined; scope = queue.shift()) {
        if (blocked) return; // nenhum escopo novo depois de um bloqueio (R-11)
        // Erro inesperado (ex.: banco) fica restrito ao escopo; a transação já desfez a gravação.
        const outcome = await this.processScope(scope, states.get(scope), latest.get(scope)).catch(
          (error: unknown): ScopeOutcome => ({
            scope,
            kind: 'failed',
            reason: `erro ao processar: ${error instanceof Error ? error.message : error}`,
          }),
        );
        if (outcome.kind === 'failed' && outcome.reason === 'blocked') blocked = true;
        outcomes.push(outcome);
      }
    };
    await Promise.all(Array.from({ length: MAX_CONCURRENT_REQUESTS }, worker));

    const br = outcomes.find((o) => o.scope === 'br');
    const brSuccess = br !== undefined && SUCCESS_KINDS.has(br.kind);
    const error = brSuccess
      ? null
      : br?.kind === 'failed'
        ? br.reason
        : 'escopo br não consultado (recuo ou bloqueio)';
    await this.repository.recordCycle(code, { attemptAt, success: brSuccess, error });

    this.logSummary(outcomes);
    return { blocked, outcomes, brSuccess };
  }

  /** Loop do worker: ciclo → espera o intervalo após o término → … até `signal` abortar. */
  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        await this.runCycle();
      } catch (error) {
        this.logger.warn(`ciclo falhou: ${error instanceof Error ? error.message : error}`);
      }
      await sleep(this.config.pollIntervalSeconds * 1000, signal);
    }
  }

  private async processScope(
    scope: Scope,
    state: ScopeSourceStateRecord | undefined,
    previous: StoredScopeResult | undefined,
  ): Promise<ScopeOutcome> {
    const code = this.config.electionCode;
    const failed = (reason: string): ScopeOutcome => ({ scope, kind: 'failed', reason });

    let fetched;
    try {
      fetched = await this.source.fetchScope(scope, state?.lastEtag ?? null);
    } catch (error) {
      return failed(error instanceof Error ? error.message : String(error));
    }

    switch (fetched.kind) {
      case 'blocked':
        await this.repository.markBlocked(code, nextBlockedUntil(this.clock.now()));
        return failed('blocked');
      case 'not_found':
        await this.repository.markNotFound(code, scope, nextNotFoundUntil(this.clock.now()));
        return failed('not_found');
      case 'error':
        return failed(fetched.reason);
      case 'not_modified':
        await this.repository.touchScope(code, scope, { seenAt: this.clock.now() });
        return { scope, kind: 'not_modified' };
    }

    const verified = verifyJws(fetched.body, this.config.jwk);
    if (!verified.ok) return failed(verified.reason);

    const validated = validatePayload(verified.payload, {
      electionCode: code,
      scope,
      sides: this.config.sides,
    });
    if (!validated.ok) return failed(`payload inválido: ${validated.reasons.join('; ')}`);

    const result = validated.result;
    const hash = contentHash(result);
    const decision = decideAcceptance(
      { lastGeneratedAt: state?.lastGeneratedAt ?? null, lastHash: previous?.contentHash ?? null },
      { generatedAt: result.generatedAt, hash },
    );

    if (decision === 'stale') return { scope, kind: 'stale' };
    if (decision === 'unchanged') {
      await this.repository.touchScope(code, scope, {
        seenAt: this.clock.now(),
        generatedAt: result.generatedAt,
        etag: fetched.etag,
      });
      return { scope, kind: 'unchanged' };
    }

    const previousResult = previous?.result ?? null;
    const events = generateEvents(previousResult, result, this.config.sides);
    await this.repository.saveAcceptedResult({
      result,
      contentHash: hash,
      etag: fetched.etag,
      rawPayload: verified.payload,
      receivedAt: this.clock.now(),
      events,
      combatEvent: toCombatEvent(events, previousResult, result, this.config.sides),
    });
    return { scope, kind: 'accepted' };
  }

  private logSummary(outcomes: ScopeOutcome[]): void {
    const count = (kind: ScopeOutcome['kind']) => outcomes.filter((o) => o.kind === kind).length;
    this.logger.log(
      `ciclo: ${outcomes.length} escopos — aceitos ${count('accepted')}, sem mudança ` +
        `${count('unchanged') + count('not_modified')}, atrasados ${count('stale')}, ` +
        `falhas ${count('failed')}`,
    );
    for (const outcome of outcomes) {
      if (outcome.kind === 'failed') this.logger.warn(`${outcome.scope}: ${outcome.reason}`);
    }
  }
}

/** Espera `ms`, retornando antes se o sinal for abortado. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done);
  });
}
