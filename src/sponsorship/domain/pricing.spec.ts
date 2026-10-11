import { priceTierOf, quote, standardTable } from './pricing';

const pricesCents = { floor: 500_000, center: 300_000, glove: 200_000, side: 100_000 };
const standardPricesCents = standardTable(pricesCents, 500);
const config = { pricesCents, standardPricesCents };

describe('quote — spec sponsorships R-3 + sponsorship-election-pricing R-2 (AC-01)', () => {
  it.each([
    ['floor', 3, 500_000, 1_500_000],
    ['center', 1, 300_000, 300_000],
    ['glove_red', 2, 200_000, 400_000],
    ['glove_blue', 2, 200_000, 400_000],
    ['side_left', 60, 100_000, 6_000_000],
    ['side_right', 60, 100_000, 6_000_000],
  ] as const)('dia da eleição: %s × %i min', (slot, minutes, unit, amount) => {
    expect(quote(slot, minutes, 'election_day', config)).toEqual({
      priceTier: 'election_day',
      unitPriceCents: unit,
      amountCents: amount,
    });
  });

  it.each([
    ['floor', 3, 2_500, 7_500],
    ['center', 1, 1_500, 1_500],
    ['glove_red', 2, 1_000, 2_000],
    ['glove_blue', 2, 1_000, 2_000],
    ['side_left', 60, 500, 30_000],
    ['side_right', 60, 500, 30_000],
  ] as const)('reduzida: %s × %i min', (slot, minutes, unit, amount) => {
    expect(quote(slot, minutes, 'standard', config)).toEqual({
      priceTier: 'standard',
      unitPriceCents: unit,
      amountCents: amount,
    });
  });
});

describe('standardTable — R-2 (AC-01)', () => {
  it('padrões: laterais 500, luvas 1000, centro 1500, chão 2500', () => {
    expect(standardPricesCents).toEqual({ floor: 2_500, center: 1_500, glove: 1_000, side: 500 });
  });

  it('mantém a proporção e arredonda meio centavo para cima', () => {
    // 3 × 1/2 = 1,5 → 2; 5 × 1/2 = 2,5 → 3; 4 × 1/2 = 2; 7 × 1/2 = 3,5 → 4
    expect(standardTable({ floor: 7, center: 5, glove: 3, side: 2 }, 1)).toEqual({
      floor: 4,
      center: 3,
      glove: 2,
      side: 1,
    });
    // 1/3 de 100 = 33,33 → 33
    expect(standardTable({ floor: 100, center: 200, glove: 50, side: 300 }, 100).floor).toBe(33);
  });
});

describe('priceTierOf — R-3 (AC-03)', () => {
  const electionDay = {
    startsAt: new Date('2026-10-25T03:00:00.000Z'),
    endsAt: new Date('2026-10-26T03:00:00.000Z'),
  };
  const w = (startsAt: string, endsAt: string) => ({
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt),
  });

  it.each([
    ['inteira antes', w('2026-10-24T20:00:00Z', '2026-10-24T21:00:00Z'), 'standard'],
    ['termina exatamente no início', w('2026-10-25T02:55:00Z', '2026-10-25T03:00:00Z'), 'standard'],
    ['cruza a 00:00', w('2026-10-25T02:58:00Z', '2026-10-25T03:03:00Z'), 'election_day'],
    ['dentro do dia', w('2026-10-25T15:00:00Z', '2026-10-25T15:10:00Z'), 'election_day'],
    [
      'começa no dia e termina depois',
      w('2026-10-26T02:58:00Z', '2026-10-26T03:05:00Z'),
      'election_day',
    ],
    ['começa exatamente no fim', w('2026-10-26T03:00:00Z', '2026-10-26T03:05:00Z'), 'standard'],
    ['inteira depois', w('2026-10-27T12:00:00Z', '2026-10-27T13:00:00Z'), 'standard'],
  ] as const)('%s → %s', (_, window, tier) => {
    expect(priceTierOf(window, electionDay)).toBe(tier);
  });
});
