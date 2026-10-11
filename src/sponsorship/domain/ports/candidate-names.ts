/**
 * Nomes de urna dos dois candidatos do snapshot atual (sponsorship-image-moderation R-4 D-6).
 * Vazio sem snapshot. Aplicado igualmente aos dois lados.
 */
export interface CandidateNames {
  ballotNames(): Promise<string[]>;
}

export const CANDIDATE_NAMES = Symbol('CANDIDATE_NAMES');
