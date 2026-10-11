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

/** Descrição em pt-BR do espaço, enviada ao analisador de imagens (sponsorship-image-moderation R-8). */
export function slotPlacement(slot: SponsorshipSlot): string {
  switch (slot) {
    case 'side_left':
      return 'painel vertical lateral esquerdo do fundo da arena';
    case 'side_right':
      return 'painel vertical lateral direito do fundo da arena';
    case 'center':
      return 'faixa horizontal central do fundo da arena';
    case 'floor':
      return 'retângulo central do piso da arena';
    case 'glove_red':
    case 'glove_blue':
      return 'adesivo quadrado na luva de um lutador';
  }
}
