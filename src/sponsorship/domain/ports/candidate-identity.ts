/** Nome e número de urna de um dos dois lados (sponsorship-image-moderation R-4 D-5, D-6). */
export interface CandidateRef {
  ballotName: string;
  number: number;
}

/**
 * Identidade dos dois candidatos do snapshot atual. Vazio sem snapshot. Aplicada igualmente aos
 * dois lados.
 */
export interface CandidateIdentity {
  candidates(): Promise<CandidateRef[]>;
}

export const CANDIDATE_IDENTITY = Symbol('CANDIDATE_IDENTITY');
