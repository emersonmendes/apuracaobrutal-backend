import { normalizeLinkUrl } from './link-url';

describe('normalizeLinkUrl — spec sponsor-link R-1 (AC-01)', () => {
  it.each([
    [undefined, null],
    [null, null],
    ['', null],
    ['   ', null],
    ['https://exemplo.com/x?a=1', 'https://exemplo.com/x?a=1'],
    ['  http://exemplo.com  ', 'http://exemplo.com'],
    ['https://sub.exemplo.com.br/caminho#frag', 'https://sub.exemplo.com.br/caminho#frag'],
  ])('%j → %j', (raw, value) => {
    expect(normalizeLinkUrl(raw)).toEqual({ ok: true, value });
  });

  it.each([
    'exemplo.com',
    'javascript:alert(1)',
    'data:text/html,oi',
    'ftp://exemplo.com',
    'https://user:p@exemplo.com',
    'https://',
    `https://exemplo.com/${'a'.repeat(2048)}`,
    42,
    { href: 'https://x' },
  ])('%j → inválido', (raw) => {
    expect(normalizeLinkUrl(raw)).toEqual({ ok: false });
  });
});
