import { SponsorshipError } from '../domain/errors';
import type { Clock } from '../domain/ports/clock';
import type { SponsorshipRepository } from '../domain/ports/sponsorship-repository';
import { toPublic, type PublicSponsorship } from './public-sponsorship';

/** Pedido público por id (FR-03). */
export class GetSponsorship {
  constructor(
    private readonly repository: SponsorshipRepository,
    private readonly clock: Clock,
  ) {}

  async execute(id: string): Promise<PublicSponsorship> {
    const order = await this.repository.findById(id);
    if (!order) throw new SponsorshipError('not_found');
    return toPublic(order, this.clock.now());
  }
}
