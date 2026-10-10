// Eventos de apuração (spec election-results-feed R-9). Regras idênticas para os dois lados.
import type { CandidateSides } from './election-config';
import type { EventSide } from './election-snapshot';
import { findCandidate, resultTime, type ScopeResult } from './scope-result';
import { deriveStatus, isDisclosable } from './status';
import { toBrasiliaIso } from './tse-values';

export type ElectionEventKind =
  'counting_started' | 'update' | 'milestone' | 'lead_change' | 'state_completed' | 'final_result';

export interface NewElectionEvent {
  kind: ElectionEventKind;
  dedupeKey: string;
  occurredAt: Date;
  text: string;
  side: EventSide;
}

/** Evento já gravado, como lido para o snapshot. */
export interface StoredElectionEvent {
  id: string;
  occurredAt: Date;
  text: string;
  side: EventSide;
}

const MILESTONES = [25, 50, 75, 90, 100];

function pct(value: number, digits: number): string {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

interface Leader {
  side: 'red' | 'blue';
  name: string;
  pct: number;
}

/** Líder: lado com `validVotesPct` estritamente maior num resultado divulgável. */
function leaderOf(result: ScopeResult | null, sides: CandidateSides): Leader | null {
  if (!result || !isDisclosable(result)) return null;
  const red = findCandidate(result, sides.red);
  const blue = findCandidate(result, sides.blue);
  if (!red || !blue || red.validVotesPct === blue.validVotesPct) return null;
  return red.validVotesPct > blue.validVotesPct
    ? { side: 'red', name: red.ballotName, pct: red.validVotesPct }
    : { side: 'blue', name: blue.ballotName, pct: blue.validVotesPct };
}

/**
 * Gera os eventos de um novo resultado aceito, comparando com o anterior do mesmo escopo, na ordem
 * da tabela da R-9.
 */
export function generateEvents(
  previous: ScopeResult | null,
  next: ScopeResult,
  sides: CandidateSides,
): NewElectionEvent[] {
  const occurredAt = resultTime(next);
  const events: NewElectionEvent[] = [];
  const add = (kind: ElectionEventKind, dedupeKey: string, text: string, side: EventSide) =>
    events.push({ kind, dedupeKey, occurredAt, text, side });

  if (next.scope !== 'br') {
    if (next.progress === 'f' && previous?.progress !== 'f') {
      const red = findCandidate(next, sides.red);
      const blue = findCandidate(next, sides.blue);
      if (red && blue) {
        const side: EventSide =
          red.validVotesPct > blue.validVotesPct
            ? 'red'
            : blue.validVotesPct > red.validVotesPct
              ? 'blue'
              : 'neutral';
        add(
          'state_completed',
          `state_completed:${next.scope}`,
          `${next.scope.toUpperCase()}: apuração concluída — ${red.ballotName} ${pct(red.validVotesPct, 2)}% · ${blue.ballotName} ${pct(blue.validVotesPct, 2)}%`,
          side,
        );
      }
    }
    return events;
  }

  const nextDisclosable = isDisclosable(next);
  const previousDisclosable = previous !== null && isDisclosable(previous);

  if (nextDisclosable && !previousDisclosable) {
    add(
      'counting_started',
      'counting_started',
      `Começa a divulgação dos resultados do ${next.round}º turno`,
      'neutral',
    );
  }

  if (
    nextDisclosable &&
    next.totalizedAt !== null &&
    next.totalizedAt.getTime() !== previous?.totalizedAt?.getTime()
  ) {
    add(
      'update',
      `update:${toBrasiliaIso(next.totalizedAt)}`,
      `Atualização do TSE: ${pct(next.countedSectionsPct, 1)}% das urnas apuradas`,
      'neutral',
    );
  }

  const previousPct = previous?.countedSectionsPct ?? 0;
  const crossed = MILESTONES.filter((m) => previousPct < m && m <= next.countedSectionsPct);
  if (crossed.length > 0) {
    const milestone = crossed[crossed.length - 1];
    add('milestone', `milestone:${milestone}`, `${milestone}% das urnas apuradas`, 'neutral');
  }

  const previousLeader = leaderOf(previous, sides);
  const nextLeader = leaderOf(next, sides);
  if (nextLeader && nextLeader.side !== previousLeader?.side) {
    const verb = previousLeader ? 'assume a liderança com' : 'sai na frente com';
    add(
      'lead_change',
      `lead:${next.generationId}`,
      `${nextLeader.name} ${verb} ${pct(nextLeader.pct, 2)}%`,
      nextLeader.side,
    );
  }

  if (next.final && !previous?.final) {
    const { winnerId } = deriveStatus(next, sides);
    const winner = next.candidates.find((c) => c.sqcand === winnerId);
    if (winner) {
      add(
        'final_result',
        'final_result',
        `Resultado final: ${winner.ballotName} vence com ${pct(winner.validVotesPct, 2)}% dos votos válidos`,
        winner.number === sides.red ? 'red' : 'blue',
      );
    } else {
      add(
        'final_result',
        'final_result',
        'Totalização final concluída sem atribuição de eleito',
        'neutral',
      );
    }
  }

  return events;
}
