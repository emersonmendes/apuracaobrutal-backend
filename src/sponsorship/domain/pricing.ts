import type { ElectionDay, SponsorshipConfig } from './sponsorship-config';
import { priceKeyOf, type PriceKey, type SponsorshipSlot } from './slots';

/** Faixa de preço de um pedido (spec sponsorship-election-pricing R-2). */
export type PriceTier = 'standard' | 'election_day';

export interface Quote {
  priceTier: PriceTier;
  unitPriceCents: number;
  amountCents: number;
}

/**
 * Tabela reduzida proporcional à cheia, ancorada no preço reduzido das laterais; arredonda para o
 * centavo mais próximo, meio centavo para cima (R-2).
 */
export function standardTable(
  full: Record<PriceKey, number>,
  standardSideCents: number,
): Record<PriceKey, number> {
  // Aritmética inteira: round(a/b) meio-para-cima = floor((2a + b) / 2b).
  const scale = (cents: number) =>
    Math.floor((2 * cents * standardSideCents + full.side) / (2 * full.side));
  return {
    floor: scale(full.floor),
    center: scale(full.center),
    glove: scale(full.glove),
    side: standardSideCents,
  };
}

/**
 * Faixa de uma janela no ar: `election_day` se `[startsAt, endsAt)` intersecta o dia da eleição
 * (limites semiabertos); senão `standard` (R-3). Vale para o pedido inteiro.
 */
export function priceTierOf(
  window: { startsAt: Date; endsAt: Date },
  electionDay: Pick<ElectionDay, 'startsAt' | 'endsAt'>,
): PriceTier {
  const touches =
    window.startsAt.getTime() < electionDay.endsAt.getTime() &&
    window.endsAt.getTime() > electionDay.startsAt.getTime();
  return touches ? 'election_day' : 'standard';
}

/** Valor do pedido = minutos × preço/min do local na faixa (sponsorships R-3; R-2, R-4). */
export function quote(
  slot: SponsorshipSlot,
  minutes: number,
  priceTier: PriceTier,
  config: Pick<SponsorshipConfig, 'pricesCents' | 'standardPricesCents'>,
): Quote {
  const table = priceTier === 'election_day' ? config.pricesCents : config.standardPricesCents;
  const unitPriceCents = table[priceKeyOf(slot)];
  return { priceTier, unitPriceCents, amountCents: minutes * unitPriceCents };
}
