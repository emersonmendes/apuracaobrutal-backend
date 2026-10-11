import { normalizeCpfCnpj } from './payer';

describe('normalizeCpfCnpj — spec asaas-payment R-2 (AC-01)', () => {
  it.each([
    ['529.982.247-25', '52998224725'],
    ['52998224725', '52998224725'],
    ['249.715.637-92', '24971563792'],
    ['11.222.333/0001-81', '11222333000181'],
    ['11222333000181', '11222333000181'],
    [' 529 982 247 25 ', '52998224725'],
  ])('%s → %s', (raw, digits) => {
    expect(normalizeCpfCnpj(raw)).toBe(digits);
  });

  it.each([
    ['dígito verificador errado (CPF)', '529.982.247-26'],
    ['dígito verificador errado (CNPJ)', '11.222.333/0001-82'],
    ['todos iguais (CPF)', '111.111.111-11'],
    ['todos iguais (CNPJ)', '00.000.000/0000-00'],
    ['10 dígitos', '5299822472'],
    ['12 dígitos', '112223330001'],
    ['letras', '529.982.247-2a'],
    ['vazio', ''],
    ['não é texto', 52998224725],
    ['indefinido', undefined],
  ])('%s → null', (_label, raw) => {
    expect(normalizeCpfCnpj(raw)).toBeNull();
  });
});
