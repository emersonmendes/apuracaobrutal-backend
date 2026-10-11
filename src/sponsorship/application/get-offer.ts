import { priceTierOf, quote, type PriceTier } from '../domain/pricing';
import { schedule } from '../domain/scheduling';
import { SPONSORSHIP_SLOTS, type SponsorshipSlot } from '../domain/slots';
import { purchaseAvailable, type SponsorshipConfig } from '../domain/sponsorship-config';
import type { Clock } from '../domain/ports/clock';
import type { SponsorshipRepository } from '../domain/ports/sponsorship-repository';

export interface SponsorOffer {
  available: boolean;
  maxMinutes: number;
  serverTime: Date;
  electionDay: { date: string; startsAt: Date; endsAt: Date };
  slots: {
    slot: SponsorshipSlot;
    unitPriceCents: number;
    electionDayUnitPriceCents: number;
    priceTier: PriceTier;
    queueEndsAt: Date | null;
  }[];
}

/**
 * Oferta: preço/min (na faixa atual), preço do dia da eleição e fim da fila de cada local, na
 * ordem da R-1 (FR-03, R-6, R-9; sponsorship-election-pricing FR-03).
 */
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
      electionDay: this.config.electionDay,
      slots: SPONSORSHIP_SLOTS.map((slot) => {
        const end = queueEnds[slot];
        // Pedido de 1 minuto começando na previsão atual do local (sponsorship-election-pricing R-4).
        const tier = priceTierOf(schedule(now, 1, end ?? null), this.config.electionDay);
        return {
          slot,
          unitPriceCents: quote(slot, 1, tier, this.config).unitPriceCents,
          electionDayUnitPriceCents: quote(slot, 1, 'election_day', this.config).unitPriceCents,
          priceTier: tier,
          queueEndsAt: end && end.getTime() > now.getTime() ? end : null,
        };
      }),
    };
  }
}
