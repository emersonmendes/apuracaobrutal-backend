import { SponsorshipError } from '../domain/errors';
import { purchaseAvailable, type SponsorshipConfig } from '../domain/sponsorship-config';
import type { Clock } from '../domain/ports/clock';
import type { SponsorshipRepository } from '../domain/ports/sponsorship-repository';
import { toPublic, type PublicSponsorship } from './public-sponsorship';

/**
 * Confirma o pagamento e agenda (spec sponsorships FR-04, R-9, Fluxo 3). Idempotente. É o mesmo
 * ponto de entrada que um webhook de provedor real usará.
 */
export class ConfirmPayment {
  constructor(
    private readonly repository: SponsorshipRepository,
    private readonly clock: Clock,
    private readonly config: SponsorshipConfig,
  ) {}

  async execute(id: string): Promise<PublicSponsorship> {
    if (!purchaseAvailable(this.config)) throw new SponsorshipError('unavailable');
    const now = this.clock.now();
    const outcome = await this.repository.confirm(id, now, this.config.electionDay);
    if (outcome.kind === 'not_found') throw new SponsorshipError('not_found');
    if (outcome.kind === 'expired') throw new SponsorshipError('expired');
    if (outcome.kind === 'price_changed') throw new SponsorshipError('price_changed');
    return toPublic(outcome.sponsorship, now);
  }
}
