import { localDateOf } from './local-date';

describe('localDateOf — spec asaas-payment R-3', () => {
  it('usa a data civil de São Paulo, não a UTC', () => {
    // 02:20Z = 23:20 do dia anterior em São Paulo (UTC−3).
    expect(localDateOf(new Date('2026-10-26T02:20:00.000Z'))).toBe('2026-10-25');
    expect(localDateOf(new Date('2026-10-26T03:00:00.000Z'))).toBe('2026-10-26');
    expect(localDateOf(new Date('2026-10-26T12:00:00.000Z'))).toBe('2026-10-26');
  });
});
