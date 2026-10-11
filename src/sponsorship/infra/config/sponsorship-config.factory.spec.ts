import {
  InvalidSponsorshipConfigError,
  parseSponsorshipConfig,
} from './sponsorship-config.factory';

describe('parseSponsorshipConfig — spec sponsorships FR-01 (AC-01)', () => {
  it('usa os padrões da spec', () => {
    expect(parseSponsorshipConfig({})).toEqual({
      gateway: 'simulated',
      production: false,
      pricesCents: { floor: 500_000, center: 300_000, glove: 200_000, side: 100_000 },
      maxMinutes: 60,
      leadSeconds: 60,
      paymentTtlMinutes: 30,
      imageMaxBytes: 2_097_152,
      storageDir: './storage/sponsorships',
      createLimitPerHour: 10,
    });
  });

  it('lê os valores do ambiente e marca produção', () => {
    const config = parseSponsorshipConfig({
      NODE_ENV: 'production',
      SPONSORSHIP_PRICE_GLOVE_CENTS: '250000',
      SPONSORSHIP_MAX_MINUTES: '10',
    });
    expect(config.production).toBe(true);
    expect(config.pricesCents.glove).toBe(250_000);
    expect(config.maxMinutes).toBe(10);
  });

  it.each([
    ['SPONSORSHIP_PRICE_FLOOR_CENTS', '0'],
    ['SPONSORSHIP_PRICE_CENTER_CENTS', '-100'],
    ['SPONSORSHIP_PRICE_GLOVE_CENTS', '19.90'],
    ['SPONSORSHIP_PRICE_SIDE_CENTS', 'mil'],
    ['SPONSORSHIP_MAX_MINUTES', '0'],
    ['SPONSORSHIP_LEAD_SECONDS', '29'],
    ['SPONSORSHIP_PAYMENT_TTL_MINUTES', '4'],
    ['PAYMENT_GATEWAY', 'stripe'],
  ])('%s=%s impede a inicialização', (name, raw) => {
    expect(() => parseSponsorshipConfig({ [name]: raw })).toThrow(InvalidSponsorshipConfigError);
  });

  it('acumula todos os problemas', () => {
    try {
      parseSponsorshipConfig({ SPONSORSHIP_PRICE_FLOOR_CENTS: '0', SPONSORSHIP_MAX_MINUTES: 'x' });
      fail('deveria lançar');
    } catch (error) {
      expect((error as InvalidSponsorshipConfigError).problems).toHaveLength(2);
    }
  });
});
