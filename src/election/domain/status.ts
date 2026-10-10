// Status, vencedor e votos divulgáveis (spec election-results-feed R-6).
import type { CandidateSides } from './election-config';
import type { ElectionStatus } from './election-snapshot';
import { findCandidate, type ScopeResult } from './scope-result';

/** Há votos divulgáveis: `dv = s` e `and ≠ n`. */
export function isDisclosable(result: ScopeResult): boolean {
  return result.disclosable && result.progress !== 'n';
}

/** Tabela da R-6, a partir do arquivo `br` mais recente. */
export function deriveStatus(
  br: ScopeResult,
  sides: CandidateSides,
): { status: ElectionStatus; winnerId: string | null } {
  if (br.final) {
    const elected = [findCandidate(br, sides.red), findCandidate(br, sides.blue)].filter(
      (candidate) => candidate?.elected,
    );
    const winnerId = !br.noWinnerAssigned && elected.length === 1 ? elected[0]!.sqcand : null;
    return { status: 'final', winnerId };
  }
  if (!isDisclosable(br)) return { status: 'not_started', winnerId: null };
  return { status: 'partial', winnerId: null };
}

/** Percentuais de uma UF; `null` sem votos divulgáveis ou com `vv = 0`. */
export function ufShares(
  result: ScopeResult,
  sides: CandidateSides,
): { redPct: number; bluePct: number } | null {
  if (!isDisclosable(result) || result.validVotes === 0) return null;
  const red = findCandidate(result, sides.red);
  const blue = findCandidate(result, sides.blue);
  if (!red || !blue) return null;
  return { redPct: red.validVotesPct, bluePct: blue.validVotesPct };
}
