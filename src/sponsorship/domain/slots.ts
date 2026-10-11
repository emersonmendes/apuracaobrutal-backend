/**
 * Locais de patrocínio da arena (spec sponsorships R-1), na ordem da UI. Cada par simétrico
 * compartilha uma única chave de preço (R-2): não existe preço diferente por lado.
 */
export const SPONSORSHIP_SLOTS = [
  'side_left',
  'side_right',
  'center',
  'floor',
  'glove_red',
  'glove_blue',
] as const;

export type SponsorshipSlot = (typeof SPONSORSHIP_SLOTS)[number];

export type PriceKey = 'floor' | 'center' | 'glove' | 'side';

export function isSlot(value: unknown): value is SponsorshipSlot {
  return typeof value === 'string' && (SPONSORSHIP_SLOTS as readonly string[]).includes(value);
}

export function priceKeyOf(slot: SponsorshipSlot): PriceKey {
  switch (slot) {
    case 'side_left':
    case 'side_right':
      return 'side';
    case 'glove_red':
    case 'glove_blue':
      return 'glove';
    default:
      return slot;
  }
}
