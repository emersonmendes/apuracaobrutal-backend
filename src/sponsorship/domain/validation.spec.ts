import { validateOrderInput, type RawOrderInput } from './validation';

const valid: RawOrderInput = {
  slot: 'center',
  minutes: '5',
  advertiserName: '  Padaria Central ',
  email: 'contato@padaria.com.br',
  cpfCnpj: '529.982.247-25',
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
        cpfCnpj: '52998224725',
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
    [{ cpfCnpj: '529.982.247-26' }, 'invalid_cpf_cnpj'],
    [{ cpfCnpj: '111.111.111-11' }, 'invalid_cpf_cnpj'],
    [{ cpfCnpj: undefined }, 'invalid_cpf_cnpj'],
    [{ acceptTerms: 'false' }, 'terms_not_accepted'],
    [{ acceptTerms: undefined }, 'terms_not_accepted'],
  ])('%j → %s', (override, code) => {
    expect(validateOrderInput({ ...valid, ...override }, 60)).toEqual({ ok: false, code });
  });

  it('aceita os limites 1 e max e minutos numéricos', () => {
    expect(validateOrderInput({ ...valid, minutes: '1' }, 60).ok).toBe(true);
    expect(validateOrderInput({ ...valid, minutes: 60 }, 60).ok).toBe(true);
  });

  it('CPF/CNPJ é verificado depois do e-mail e antes dos termos (asaas-payment R-2)', () => {
    expect(validateOrderInput({ ...valid, email: 'x', cpfCnpj: 'y' }, 60)).toEqual({
      ok: false,
      code: 'invalid_email',
    });
    expect(validateOrderInput({ ...valid, cpfCnpj: 'y', acceptTerms: 'false' }, 60)).toEqual({
      ok: false,
      code: 'invalid_cpf_cnpj',
    });
    expect(validateOrderInput({ ...valid, cpfCnpj: '11.222.333/0001-81' }, 60)).toMatchObject({
      ok: true,
      value: { cpfCnpj: '11222333000181' },
    });
  });

  it('verifica na ordem dos campos: local antes de minutos', () => {
    expect(validateOrderInput({ slot: 'x', minutes: 'y' }, 60)).toEqual({
      ok: false,
      code: 'invalid_slot',
    });
  });
});
