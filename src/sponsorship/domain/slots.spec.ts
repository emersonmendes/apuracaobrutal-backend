import { SPONSORSHIP_SLOTS, isSlot, priceKeyOf } from './slots';

describe('slots — spec sponsorships R-1, R-2', () => {
  it('lista os seis locais na ordem da R-1', () => {
    expect(SPONSORSHIP_SLOTS).toEqual([
      'side_left',
      'side_right',
      'center',
      'floor',
      'glove_red',
      'glove_blue',
    ]);
  });

  it('pares simétricos compartilham a mesma chave de preço (neutralidade)', () => {
    expect(priceKeyOf('side_left')).toBe(priceKeyOf('side_right'));
    expect(priceKeyOf('glove_red')).toBe(priceKeyOf('glove_blue'));
    expect(priceKeyOf('center')).toBe('center');
    expect(priceKeyOf('floor')).toBe('floor');
  });

  it('reconhece só os locais conhecidos', () => {
    expect(isSlot('floor')).toBe(true);
    expect(isSlot('ceiling')).toBe(false);
    expect(isSlot(1)).toBe(false);
  });
});
