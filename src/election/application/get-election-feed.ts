// Leitura do feed da home (spec election-results-feed FR-06, FR-07, R-10; Fluxo 4).
import {
  buildSnapshot,
  SNAPSHOT_COMBAT_EVENT_LIMIT,
  SNAPSHOT_EVENT_LIMIT,
} from '../domain/build-snapshot';
import type { ElectionConfig, Scope } from '../domain/election-config';
import type { ElectionFeedResponse, SourceStatus } from '../domain/election-snapshot';
import type { Clock } from '../domain/ports/clock';
import type { ElectionRepository } from '../domain/ports/election-repository';
import type { ScopeResult } from '../domain/scope-result';
import { computeSourceStatus } from '../domain/source-health';

/** Histórico do `br` lido para a timeline (cobre os 500 pontos da R-12 com folga). */
export const BR_HISTORY_LIMIT = 2000;

export interface FeedVersion {
  feedVersion: number;
  sourceStatus: SourceStatus;
}

export class GetElectionFeed {
  constructor(
    private readonly repository: ElectionRepository,
    private readonly clock: Clock,
    private readonly config: ElectionConfig,
  ) {}

  /** Leitura leve, feita a cada `FEED_REFRESH_MS`. */
  async getVersion(): Promise<FeedVersion> {
    const status = await this.repository.getSourceStatus(this.config.electionCode);
    return {
      feedVersion: status?.feedVersion ?? 0,
      sourceStatus: computeSourceStatus(
        status?.lastSuccessAt ?? null,
        this.clock.now(),
        this.config.staleAfterSeconds,
      ),
    };
  }

  async getFeed(): Promise<ElectionFeedResponse & { feedVersion: number }> {
    const code = this.config.electionCode;
    const [version, latest, brHistory, events, combatEvents, terminalCombatEvent] =
      await Promise.all([
        this.getVersion(),
        this.repository.getLatestScopeResults(code),
        this.repository.getBrHistory(code, BR_HISTORY_LIMIT),
        this.repository.getRecentEvents(code, SNAPSHOT_EVENT_LIMIT),
        this.repository.getRecentCombatEvents(code, SNAPSHOT_COMBAT_EVENT_LIMIT),
        this.repository.getLatestTerminalCombatEvent(code),
      ]);

    const latestByScope = new Map<Scope, ScopeResult>();
    for (const [scope, stored] of latest) latestByScope.set(scope, stored.result);

    return {
      feedVersion: version.feedVersion,
      sourceStatus: version.sourceStatus,
      snapshot: buildSnapshot({
        latestByScope,
        brHistory,
        events,
        combatEvents,
        terminalCombatEvent,
        config: this.config,
      }),
    };
  }
}
