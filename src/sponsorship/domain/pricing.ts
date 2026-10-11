import type { SponsorshipConfig } from './sponsorship-config';
import { priceKeyOf, type SponsorshipSlot } from './slots';

export interface Quote {
  unitPriceCents: number;
  amountCents: number;
}

/** Valor do pedido = minutos × preço/min do local, em centavos inteiros (R-3). */
export function quote(
  slot: SponsorshipSlot,
  minutes: number,
  config: Pick<SponsorshipConfig, 'pricesCents'>,
): Quote {
  const unitPriceCents = config.pricesCents[priceKeyOf(slot)];
  return { unitPriceCents, amountCents: minutes * unitPriceCents };
}
