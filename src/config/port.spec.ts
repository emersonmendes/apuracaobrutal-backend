import { DEFAULT_PORT, resolvePort } from './port';

describe('resolvePort — specs/backend-bootstrap', () => {
  it('usa 3433 quando PORT está ausente (AC-11)', () => {
    expect(resolvePort(undefined)).toBe(3433);
    expect(DEFAULT_PORT).toBe(3433);
  });

  it('usa 3433 quando PORT está vazia (AC-11)', () => {
    expect(resolvePort('  ')).toBe(3433);
  });

  it('usa o valor de PORT quando definida (AC-11)', () => {
    expect(resolvePort('4000')).toBe('4000');
  });
});
