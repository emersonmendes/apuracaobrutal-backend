import { validateOrderInput, type RawOrderInput } from './validation';

const valid: RawOrderInput = {
  slot: 'center',
  minutes: '5',
  advertiserName: '  Padaria Central ',
  email: 'contato@padaria.com.br',
  acceptTerms: 'true',
};

describe('validateOrderInput — spec sponsorships R-3, R-8 (AC-02, AC-04)', () => {
  it('aceita um pedido válido e normaliza os campos', () => {
    expect(validateOrderInput(valid, 60)).toEqual({
      ok: true,
      value: {
        slot: 'center',
        minutes: 5,
        advertiserName: 'Padaria Central',
        email: 'contato@padaria.com.br',
      },
    });
  });

  it.each([
    [{ slot: 'roof' }, 'invalid_slot'],
    [{ slot: undefined }, 'invalid_slot'],
    [{ minutes: '0' }, 'invalid_minutes'],
    [{ minutes: '61' }, 'invalid_minutes'],
    [{ minutes: '1.5' }, 'invalid_minutes'],
    [{ minutes: '-1' }, 'invalid_minutes'],
    [{ minutes: 'abc' }, 'invalid_minutes'],
    [{ minutes: undefined }, 'invalid_minutes'],
    [{ advertiserName: ' a ' }, 'invalid_advertiser'],
    [{ advertiserName: 'x'.repeat(81) }, 'invalid_advertiser'],
    [{ advertiserName: undefined }, 'invalid_advertiser'],
    [{ email: 'sem-arroba' }, 'invalid_email'],
    [{ email: `${'a'.repeat(250)}@b.co` }, 'invalid_email'],
    [{ acceptTerms: 'false' }, 'terms_not_accepted'],
    [{ acceptTerms: undefined }, 'terms_not_accepted'],
  ])('%j → %s', (override, code) => {
    expect(validateOrderInput({ ...valid, ...override }, 60)).toEqual({ ok: false, code });
  });

  it('aceita os limites 1 e max e minutos numéricos', () => {
    expect(validateOrderInput({ ...valid, minutes: '1' }, 60).ok).toBe(true);
    expect(validateOrderInput({ ...valid, minutes: 60 }, 60).ok).toBe(true);
  });

  it('verifica na ordem dos campos: local antes de minutos', () => {
    expect(validateOrderInput({ slot: 'x', minutes: 'y' }, 60)).toEqual({
      ok: false,
      code: 'invalid_slot',
    });
  });
});
