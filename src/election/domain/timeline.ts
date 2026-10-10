// Timeline do gráfico de evolução (spec election-results-feed R-12).
import type { CandidateSides } from './election-config';
import type { TimelinePoint } from './election-snapshot';
import { findCandidate, type ScopeResult } from './scope-result';
import { isDisclosable } from './status';
import { toBrasiliaIso } from './tse-values';

export const TIMELINE_LIMIT = 500;

/**
 * @param brHistory resultados do escopo `br` na ordem em que foram aceitos (mais antigo primeiro).
 */
export function buildTimeline(brHistory: ScopeResult[], sides: CandidateSides): TimelinePoint[] {
  const byTime = new Map<number, TimelinePoint>();
  for (const result of brHistory) {
    if (!isDisclosable(result) || result.totalizedAt === null) continue;
    const red = findCandidate(result, sides.red);
    const blue = findCandidate(result, sides.blue);
    if (!red || !blue) continue;
    // O último aceito com o mesmo horário prevalece.
    byTime.set(result.totalizedAt.getTime(), {
      at: toBrasiliaIso(result.totalizedAt),
      redPct: red.validVotesPct,
      bluePct: blue.validVotesPct,
    });
  }
  return [...byTime.entries()]
    .sort(([a], [b]) => a - b)
    .slice(-TIMELINE_LIMIT)
    .map(([, point]) => point);
}
