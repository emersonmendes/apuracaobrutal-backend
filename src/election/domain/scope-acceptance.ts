// Aceitação de um arquivo novo (spec election-results-feed R-3, R-7).

export type Acceptance = 'stale' | 'unchanged' | 'changed';

export interface AcceptanceReference {
  /** `generatedAt` do último arquivo aceito (inclusive sem mudança) do escopo. */
  lastGeneratedAt: Date | null;
  /** `contentHash` do último `ScopeResult` gravado do escopo. */
  lastHash: string | null;
}

export function decideAcceptance(
  reference: AcceptanceReference,
  incoming: { generatedAt: Date; hash: string },
): Acceptance {
  if (
    reference.lastGeneratedAt !== null &&
    incoming.generatedAt.getTime() < reference.lastGeneratedAt.getTime()
  ) {
    return 'stale';
  }
  return reference.lastHash === incoming.hash ? 'unchanged' : 'changed';
}
