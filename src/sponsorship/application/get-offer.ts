import { quote } from '../domain/pricing';
import { SPONSORSHIP_SLOTS, type SponsorshipSlot } from '../domain/slots';
import { purchaseAvailable, type SponsorshipConfig } from '../domain/sponsorship-config';
import type { Clock } from '../domain/ports/clock';
import type { SponsorshipRepository } from '../domain/ports/sponsorship-repository';

export interface SponsorOffer {
  available: boolean;
  maxMinutes: number;
  serverTime: Date;
  slots: { slot: SponsorshipSlot; unitPriceCents: number; queueEndsAt: Date | null }[];
}

/** Oferta: preço/min e fim da fila de cada local, na ordem da R-1 (FR-03, R-6, R-9). */
export class GetOffer {
  constructor(
    private readonly repository: SponsorshipRepository,
    private readonly clock: Clock,
    private readonly config: SponsorshipConfig,
  ) {}

  async execute(): Promise<SponsorOffer> {
    const now = this.clock.now();
    const queueEnds = await this.repository.queueEnds();
    return {
      available: purchaseAvailable(this.config),
      maxMinutes: this.config.maxMinutes,
      serverTime: now,
      slots: SPONSORSHIP_SLOTS.map((slot) => {
        const end = queueEnds[slot];
        return {
          slot,
          unitPriceCents: quote(slot, 1, this.config).unitPriceCents,
          queueEndsAt: end && end.getTime() > now.getTime() ? end : null,
        };
      }),
    };
  }
}
