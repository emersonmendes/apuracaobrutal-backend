// Saúde da fonte (spec election-results-feed R-10).
import type { SourceStatus } from './election-snapshot';

export function computeSourceStatus(
  lastSuccessAt: Date | null,
  now: Date,
  staleAfterSeconds: number,
): SourceStatus {
  if (lastSuccessAt === null) return 'failed';
  return now.getTime() - lastSuccessAt.getTime() > staleAfterSeconds * 1000 ? 'failed' : 'ok';
}
