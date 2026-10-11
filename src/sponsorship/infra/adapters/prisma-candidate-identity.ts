import type { PrismaService } from '../../../prisma/prisma.service';
import type { CandidateIdentity, CandidateRef } from '../../domain/ports/candidate-identity';

/**
 * Nome e número de urna dos dois lados a partir do último resultado `br` gravado pelo feed
 * (sponsorship-image-moderation R-4 D-5, D-6). Só consulta; nenhuma regra.
 */
export class PrismaCandidateIdentity implements CandidateIdentity {
  constructor(
    private readonly prisma: PrismaService,
    private readonly electionCode: string,
    private readonly sides: { red: number; blue: number },
  ) {}

  async candidates(): Promise<CandidateRef[]> {
    const latest = await this.prisma.scopeResult.findFirst({
      where: { electionCode: this.electionCode, scope: 'br' },
      orderBy: { id: 'desc' },
      select: { candidates: { select: { number: true, ballotName: true } } },
    });
    if (!latest) return [];
    return latest.candidates
      .filter((c) => c.number === this.sides.red || c.number === this.sides.blue)
      .map((c) => ({ ballotName: c.ballotName, number: c.number }));
  }
}
