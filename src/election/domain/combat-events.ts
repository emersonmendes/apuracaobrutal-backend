// Conversão de eventos de apuração em evento de combate (spec combat-events R-1…R-6).
// Função pura: sem framework, relógio ou aleatoriedade. Mesmos critérios para os dois lados.
import type { CandidateSides } from './election-config';
import type { ElectionEventKind, NewElectionEvent } from './election-events';
import type { CombatMove, Side } from './election-snapshot';
import { findCandidate, type ScopeResult } from './scope-result';
import { isDisclosable } from './status';

/** Variação (p.p.) abaixo da qual uma atualização vira esquiva dos dois lados (R-2, R-3). */
export const DODGE_BELOW_PP = 0.05;
/** Variação (p.p.) a partir da qual o golpe derruba (`knockback`) em vez de só acertar (`hit`). */
export const KNOCKBACK_FROM_PP = 0.5;

export interface NewCombatEvent {
  cause: ElectionEventKind;
  dedupeKey: string;
  occurredAt: Date;
  red: CombatMove;
  blue: CombatMove;
}

/** Evento de combate já gravado, como lido para o snapshot. */
export interface StoredCombatEvent {
  id: string;
  occurredAt: Date;
  red: CombatMove;
  blue: CombatMove;
}

type Moves = Pick<NewCombatEvent, 'red' | 'blue'>;

/** Estados que encerram a luta (`victory`/`defeat`). */
export const TERMINAL_MOVES: readonly CombatMove[] = ['victory', 'defeat'];

/** Golpe terminal: algum lado em `victory`/`defeat` (combat-events FR-03, R-7). */
export function isTerminalCombat(moves: Moves): boolean {
  return TERMINAL_MOVES.includes(moves.red) || TERMINAL_MOVES.includes(moves.blue);
}

/** Precedência da R-4: o primeiro da lista que gerar golpe vence. */
const PRECEDENCE: readonly ElectionEventKind[] = [
  'final_result',
  'lead_change',
  'update',
  'state_completed',
];

const BOTH_DODGE: Moves = { red: 'dodge', blue: 'dodge' };

function sideWins(side: Side, winner: CombatMove, loser: CombatMove): Moves {
  return side === 'red' ? { red: winner, blue: loser } : { red: loser, blue: winner };
}

/** Arredonda a 6 casas decimais para evitar ruído de ponto flutuante (R-3). */
function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** Golpe de um `update` pela variação de votos válidos em relação ao anterior (R-3). */
function updateMoves(
  previous: ScopeResult | null,
  next: ScopeResult,
  sides: CandidateSides,
): Moves | null {
  if (!previous || !isDisclosable(previous)) return null;
  const delta = (number: number): number | null => {
    const before = findCandidate(previous, number);
    const after = findCandidate(next, number);
    return before && after ? round6(after.validVotesPct - before.validVotesPct) : null;
  };
  const red = delta(sides.red);
  const blue = delta(sides.blue);
  if (red === null || blue === null) return null;

  const magnitude = Math.max(Math.abs(red), Math.abs(blue));
  if (magnitude < DODGE_BELOW_PP || red === blue) return BOTH_DODGE;
  const gainer: Side = red > blue ? 'red' : 'blue';
  return sideWins(gainer, 'attack', magnitude < KNOCKBACK_FROM_PP ? 'hit' : 'knockback');
}

function movesFor(
  event: NewElectionEvent,
  previous: ScopeResult | null,
  next: ScopeResult,
  sides: CandidateSides,
): Moves | null {
  switch (event.kind) {
    case 'final_result':
      return event.side === 'neutral' ? null : sideWins(event.side, 'victory', 'defeat');
    case 'lead_change':
      return event.side === 'neutral' ? null : sideWins(event.side, 'attack', 'knockback');
    case 'update':
      return updateMoves(previous, next, sides);
    case 'state_completed':
      return event.side === 'neutral' ? BOTH_DODGE : sideWins(event.side, 'attack', 'hit');
    default:
      return null; // counting_started, milestone: sem golpe
  }
}

/**
 * No máximo um evento de combate por arquivo aceito, escolhido pela precedência da R-4 entre os
 * eventos de apuração gerados para ele (R-1). Identidade e horário vêm do evento de origem (R-6).
 */
export function toCombatEvent(
  events: readonly NewElectionEvent[],
  previous: ScopeResult | null,
  next: ScopeResult,
  sides: CandidateSides,
): NewCombatEvent | null {
  for (const kind of PRECEDENCE) {
    for (const event of events.filter((candidate) => candidate.kind === kind)) {
      const moves = movesFor(event, previous, next, sides);
      if (moves) {
        return {
          cause: event.kind,
          dedupeKey: event.dedupeKey,
          occurredAt: event.occurredAt,
          ...moves,
        };
      }
    }
  }
  return null;
}
