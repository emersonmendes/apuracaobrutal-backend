// Contrato do snapshot entregue à home. Espelha exatamente `web/src/types/election.ts`
// (spec home-dashboard FR-01; election-results-feed FR-06, FR-07). Só tipos.

export type DataOrigin = 'simulated' | 'official';
export type ElectionStatus = 'not_started' | 'partial' | 'final';
export type Side = 'red' | 'blue';
export type EventSide = Side | 'neutral';
export type SourceStatus = 'ok' | 'failed';

export interface ElectionInfo {
  year: number;
  office: string;
  scope: string;
  round: 1 | 2;
}

export interface Candidate {
  id: string;
  name: string;
  party: string;
  side: Side;
  votes: number;
  validVotesPct: number;
  imageUrl?: string;
}

export interface StateResult {
  uf: string;
  countedSectionsPct: number;
  redPct: number | null;
  bluePct: number | null;
}

export interface TimelinePoint {
  at: string;
  redPct: number;
  bluePct: number;
}

export interface ElectionEvent {
  id: string;
  at: string;
  text: string;
  side: EventSide;
}

/** Estado pedido a um lutador por um evento de combate (spec combat-events FR-01, R-2). */
export type CombatMove = 'attack' | 'hit' | 'knockback' | 'dodge' | 'victory' | 'defeat';

export const COMBAT_MOVES: readonly CombatMove[] = [
  'attack',
  'hit',
  'knockback',
  'dodge',
  'victory',
  'defeat',
];

/** Golpe já decidido pelo backend (combat-events FR-03). */
export interface CombatEvent {
  id: string;
  at: string;
  red: CombatMove;
  blue: CombatMove;
}

export interface ElectionSnapshot {
  origin: DataOrigin;
  election: ElectionInfo;
  status: ElectionStatus;
  updatedAt: string;
  countedSectionsPct: number;
  candidates: [Candidate, Candidate];
  winnerId: string | null;
  states: StateResult[];
  featuredStates: string[];
  timeline: TimelinePoint[];
  events: ElectionEvent[];
  /** Os 20 golpes mais recentes, do mais antigo para o mais novo. */
  combatEvents: CombatEvent[];
}

export interface ElectionFeedResponse {
  sourceStatus: SourceStatus;
  snapshot: ElectionSnapshot | null;
}
