import { parseTrustProxy } from './trust-proxy';

describe('parseTrustProxy — specs/backend-bootstrap', () => {
  it('usa 0 quando ausente ou vazio (AC-17)', () => {
    expect(parseTrustProxy(undefined)).toBe(0);
    expect(parseTrustProxy('')).toBe(0);
    expect(parseTrustProxy('  ')).toBe(0);
  });

  it('aceita inteiros de 0 a 10 (AC-17)', () => {
    expect(parseTrustProxy('0')).toBe(0);
    expect(parseTrustProxy(' 1 ')).toBe(1);
    expect(parseTrustProxy('10')).toBe(10);
  });

  it.each(['abc', '-1', '11', '1.5', 'true', '*', '1,2'])('rejeita %p (AC-17, R-9)', (raw) => {
    expect(() => parseTrustProxy(raw)).toThrow('TRUST_PROXY inválido');
  });
});
