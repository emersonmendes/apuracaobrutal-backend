import { quote } from './pricing';

const pricesCents = { floor: 500_000, center: 300_000, glove: 200_000, side: 100_000 };

describe('quote — spec sponsorships R-3 (AC-01)', () => {
  it.each([
    ['floor', 3, 500_000, 1_500_000],
    ['center', 1, 300_000, 300_000],
    ['glove_red', 2, 200_000, 400_000],
    ['glove_blue', 2, 200_000, 400_000],
    ['side_left', 60, 100_000, 6_000_000],
    ['side_right', 60, 100_000, 6_000_000],
  ] as const)('%s × %i min', (slot, minutes, unit, amount) => {
    expect(quote(slot, minutes, { pricesCents })).toEqual({
      unitPriceCents: unit,
      amountCents: amount,
    });
  });
});
