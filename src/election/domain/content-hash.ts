// Detecção de mudança (spec election-results-feed R-7).
import { createHash } from 'node:crypto';
import type { ScopeResult } from './scope-result';

/**
 * SHA-256 do conteúdo relevante do resultado. Exclui `generatedAt` e `generationId` (o TSE
 * regenera arquivos sem mudar os números).
 */
export function contentHash(result: ScopeResult): string {
  const canonical = {
    electionCode: result.electionCode,
    scope: result.scope,
    round: result.round,
    phase: result.phase,
    totalizedAt: result.totalizedAt?.toISOString() ?? null,
    disclosable: result.disclosable,
    progress: result.progress,
    final: result.final,
    noWinnerAssigned: result.noWinnerAssigned,
    sectionsTotal: result.sectionsTotal,
    sectionsCounted: result.sectionsCounted,
    countedSectionsPct: result.countedSectionsPct,
    electorate: result.electorate,
    validVotes: result.validVotes,
    candidates: [...result.candidates]
      .sort((a, b) => a.number - b.number)
      .map((c) => [
        c.number,
        c.sqcand,
        c.ballotName,
        c.party,
        c.votes,
        c.validVotesPct,
        c.elected,
        c.situation,
      ]),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
