// Montagem do ElectionSnapshot da home (spec election-results-feed FR-06; R-4, R-5, R-6, R-8, R-12).
import type { StoredCombatEvent } from './combat-events';
import { electionYear, UF_SCOPES, type ElectionConfig, type Scope } from './election-config';
import type { StoredElectionEvent } from './election-events';
import type { Candidate, ElectionSnapshot, Side, StateResult } from './election-snapshot';
import { findCandidate, type ScopeResult } from './scope-result';
import { deriveStatus, ufShares } from './status';
import { buildTimeline } from './timeline';
import { toBrasiliaIso } from './tse-values';

export const SNAPSHOT_EVENT_LIMIT = 20;
/** Golpes no snapshot (combat-events FR-03). */
export const SNAPSHOT_COMBAT_EVENT_LIMIT = 20;

export interface SnapshotInput {
  latestByScope: ReadonlyMap<Scope, ScopeResult>;
  /** Histórico do `br`, do mais antigo para o mais novo. */
  brHistory: ScopeResult[];
  /** Eventos já ordenados (mais recente primeiro). */
  events: StoredElectionEvent[];
  /** Golpes em `seq` crescente (mais antigo primeiro). */
  combatEvents: StoredCombatEvent[];
  /** Golpe terminal mais recente da eleição (pode estar fora da janela). */
  terminalCombatEvent?: StoredCombatEvent | null;
  config: ElectionConfig;
}

function photoUrl(config: ElectionConfig, sqcand: string): string {
  return `${config.resultsUrl}/${config.cycle}/${config.electionCode}/fotos/br/${sqcand}.jpeg`;
}

/**
 * Os 20 golpes mais recentes (seq crescente). O terminal mais recente, se ficou fora da janela,
 * substitui o mais antigo e vai para o início — é mais antigo que todos os da janela (FR-03).
 */
function combatWindow(input: SnapshotInput): StoredCombatEvent[] {
  const window = input.combatEvents.slice(-SNAPSHOT_COMBAT_EVENT_LIMIT);
  const terminal = input.terminalCombatEvent;
  if (!terminal || window.some((combat) => combat.id === terminal.id)) return window;
  const rest = window.length === SNAPSHOT_COMBAT_EVENT_LIMIT ? window.slice(1) : window;
  return [terminal, ...rest];
}

export function buildSnapshot(input: SnapshotInput): ElectionSnapshot | null {
  const { latestByScope, config } = input;
  const br = latestByScope.get('br');
  if (!br) return null;

  const { status, winnerId } = deriveStatus(br, config.sides);
  const withheld = !br.disclosable;

  const candidate = (side: Side, number: number): Candidate => {
    const found = findCandidate(br, number);
    // A validação (R-2) garante a presença; o fallback só protege contra dado corrompido.
    if (!found) throw new Error(`candidato ${number} ausente no resultado br`);
    return {
      id: found.sqcand,
      name: found.ballotName,
      party: found.party,
      side,
      votes: withheld ? 0 : found.votes,
      validVotesPct: withheld ? 0 : found.validVotesPct,
      imageUrl: photoUrl(config, found.sqcand),
    };
  };

  const states: StateResult[] = UF_SCOPES.map((uf) => {
    const result = latestByScope.get(uf);
    const shares = result ? ufShares(result, config.sides) : null;
    return {
      uf: uf.toUpperCase(),
      countedSectionsPct: result?.countedSectionsPct ?? 0,
      redPct: shares?.redPct ?? null,
      bluePct: shares?.bluePct ?? null,
    };
  });

  const featuredStates = UF_SCOPES.filter((uf) => latestByScope.has(uf))
    .sort((a, b) => {
      const diff = latestByScope.get(b)!.electorate - latestByScope.get(a)!.electorate;
      return diff !== 0 ? diff : a.localeCompare(b);
    })
    .map((uf) => uf.toUpperCase());

  const origin = [...latestByScope.values()].every((r) => r.phase === 'o')
    ? 'official'
    : 'simulated';

  return {
    origin,
    election: {
      year: electionYear(config.cycle),
      office: 'PRESIDENTE',
      scope: 'BRASIL',
      round: br.round,
    },
    status,
    updatedAt: toBrasiliaIso(br.totalizedAt ?? br.generatedAt),
    countedSectionsPct: br.countedSectionsPct,
    candidates: [candidate('red', config.sides.red), candidate('blue', config.sides.blue)],
    winnerId,
    states,
    featuredStates,
    timeline: buildTimeline(input.brHistory, config.sides),
    events: input.events.slice(0, SNAPSHOT_EVENT_LIMIT).map((event) => ({
      id: event.id,
      at: toBrasiliaIso(event.occurredAt),
      text: event.text,
      side: event.side,
    })),
    combatEvents: combatWindow(input).map((combat) => ({
      id: combat.id,
      at: toBrasiliaIso(combat.occurredAt),
      red: combat.red,
      blue: combat.blue,
    })),
  };
}
