import { buildCorsOptions, DEFAULT_CORS_ORIGIN, parseCorsOrigins } from './cors';

describe('parseCorsOrigins — specs/backend-bootstrap', () => {
  it('usa a origem padrão quando a variável está ausente', () => {
    expect(parseCorsOrigins(undefined)).toEqual([DEFAULT_CORS_ORIGIN]);
  });

  it('usa a origem padrão quando a variável está vazia', () => {
    expect(parseCorsOrigins('')).toEqual([DEFAULT_CORS_ORIGIN]);
  });

  it('aceita várias origens separadas por vírgula', () => {
    expect(parseCorsOrigins('http://a.test,https://b.test')).toEqual([
      'http://a.test',
      'https://b.test',
    ]);
  });

  it('remove espaços e ignora entradas vazias', () => {
    expect(parseCorsOrigins(' http://a.test , ,https://b.test ')).toEqual([
      'http://a.test',
      'https://b.test',
    ]);
  });

  it('nunca aceita o curinga *', () => {
    expect(parseCorsOrigins('*,http://a.test')).toEqual(['http://a.test']);
  });

  it('usa a origem padrão quando só havia curinga', () => {
    expect(parseCorsOrigins('*')).toEqual([DEFAULT_CORS_ORIGIN]);
  });
});

describe('buildCorsOptions — specs/backend-bootstrap', () => {
  it('libera só a allow-list, sem credenciais e só GET/HEAD/OPTIONS', () => {
    expect(buildCorsOptions(['http://a.test'])).toEqual({
      origin: ['http://a.test'],
      credentials: false,
      methods: ['GET', 'HEAD', 'OPTIONS'],
    });
  });
});
