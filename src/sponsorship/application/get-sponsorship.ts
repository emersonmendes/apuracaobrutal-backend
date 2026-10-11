import { SponsorshipError } from '../domain/errors';
import type { SponsorshipConfig } from '../domain/sponsorship-config';
import type { Clock } from '../domain/ports/clock';
import type { SponsorshipRepository } from '../domain/ports/sponsorship-repository';
import { toPublic, type PublicSponsorship } from './public-sponsorship';
import type { ReconcilePendingPayment } from './reconcile-pending-payment';

/**
 * Pedido público por id (FR-03). Com gateway real, um pedido pendente é conferido no gateway antes
 * da resposta (asaas-payment R-5 b).
 */
export class GetSponsorship {
  constructor(
    private readonly repository: SponsorshipRepository,
    private readonly clock: Clock,
    private readonly config: SponsorshipConfig,
    private readonly reconcile?: ReconcilePendingPayment,
  ) {}

  async execute(id: string): Promise<PublicSponsorship> {
    let order = await this.repository.findById(id);
    if (!order) throw new SponsorshipError('not_found');
    if (this.reconcile) order = await this.reconcile.execute(order);
    return toPublic(order, this.clock.now(), this.config);
  }
}
