// Resultado normalizado de um arquivo EA20 (spec election-results-feed FR-04).
import type { Scope } from './election-config';

export interface CandidateResult {
  /** Número na urna. */
  number: number;
  sqcand: string;
  /** Nome de urna (`nmu`), como o TSE publica. */
  ballotName: string;
  /** Sigla do partido. */
  party: string;
  votes: number;
  validVotesPct: number;
  elected: boolean;
  situation: string | null;
}

export type Phase = 'o' | 's';
export type Progress = 'n' | 'p' | 'f';

export interface ScopeResult {
  electionCode: string;
  scope: Scope;
  round: 1 | 2;
  phase: Phase;
  generationId: string;
  generatedAt: Date;
  totalizedAt: Date | null;
  disclosable: boolean;
  progress: Progress;
  final: boolean;
  noWinnerAssigned: boolean;
  sectionsTotal: number;
  sectionsCounted: number;
  countedSectionsPct: number;
  electorate: number;
  validVotes: number;
  candidates: CandidateResult[];
}

/** Resultado já gravado, com o hash de conteúdo (R-7). */
export interface StoredScopeResult {
  result: ScopeResult;
  contentHash: string;
}

export function findCandidate(result: ScopeResult, number: number): CandidateResult | undefined {
  return result.candidates.find((candidate) => candidate.number === number);
}

/** Horário do resultado para eventos e timeline: totalização, ou geração (R-8, R-9). */
export function resultTime(result: ScopeResult): Date {
  return result.totalizedAt ?? result.generatedAt;
}
