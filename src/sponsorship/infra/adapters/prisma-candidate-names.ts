import type { PrismaService } from '../../../prisma/prisma.service';
import type { CandidateNames } from '../../domain/ports/candidate-names';

/**
 * Nomes de urna dos dois lados a partir do último resultado `br` gravado pelo feed
 * (sponsorship-image-moderation R-4 D-6). Só consulta; nenhuma regra.
 */
export class PrismaCandidateNames implements CandidateNames {
  constructor(
    private readonly prisma: PrismaService,
    private readonly electionCode: string,
    private readonly sides: { red: number; blue: number },
  ) {}

  async ballotNames(): Promise<string[]> {
    const latest = await this.prisma.scopeResult.findFirst({
      where: { electionCode: this.electionCode, scope: 'br' },
      orderBy: { id: 'desc' },
      select: { candidates: { select: { number: true, ballotName: true } } },
    });
    if (!latest) return [];
    return latest.candidates
      .filter((c) => c.number === this.sides.red || c.number === this.sides.blue)
      .map((c) => c.ballotName);
  }
}
