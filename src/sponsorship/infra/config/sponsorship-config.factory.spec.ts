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
      standardPricesCents: { floor: 2_500, center: 1_500, glove: 1_000, side: 500 },
      electionDay: {
        date: '2026-10-25',
        startsAt: new Date('2026-10-25T03:00:00.000Z'),
        endsAt: new Date('2026-10-26T03:00:00.000Z'),
      },
      maxMinutes: 60,
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
    ['SPONSORSHIP_PAYMENT_TTL_MINUTES', '4'],
    ['PAYMENT_GATEWAY', 'stripe'],
    ['SPONSORSHIP_STANDARD_PRICE_SIDE_CENTS', '0'],
    ['SPONSORSHIP_STANDARD_PRICE_SIDE_CENTS', '4.5'],
    ['SPONSORSHIP_ELECTION_DATE', '25/10/2026'],
    ['SPONSORSHIP_ELECTION_DATE', '2026-02-30'],
    ['SPONSORSHIP_ELECTION_DATE', '2026-13-01'],
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

  describe('preço por período — spec sponsorship-election-pricing FR-01 (AC-02)', () => {
    it('converte a data no dia inteiro de America/Sao_Paulo', () => {
      const config = parseSponsorshipConfig({ SPONSORSHIP_ELECTION_DATE: '2026-10-04' });
      expect(config.electionDay).toEqual({
        date: '2026-10-04',
        startsAt: new Date('2026-10-04T03:00:00.000Z'),
        endsAt: new Date('2026-10-05T03:00:00.000Z'),
      });
    });

    it('usa o offset histórico real do fuso (horário de verão de 2018)', () => {
      // Em 2018-11-04 começou o horário de verão: o dia teve 23 h (UTC-2 a partir das 00:00).
      const { electionDay } = parseSponsorshipConfig({ SPONSORSHIP_ELECTION_DATE: '2018-11-04' });
      expect(electionDay.startsAt).toEqual(new Date('2018-11-04T03:00:00.000Z'));
      expect(electionDay.endsAt).toEqual(new Date('2018-11-05T02:00:00.000Z'));
    });

    it('tabela reduzida segue a proporção da cheia configurada', () => {
      const config = parseSponsorshipConfig({
        SPONSORSHIP_PRICE_SIDE_CENTS: '200000',
        SPONSORSHIP_STANDARD_PRICE_SIDE_CENTS: '1000',
      });
      expect(config.standardPricesCents).toEqual({
        floor: 2_500,
        center: 1_500,
        glove: 1_000,
        side: 1_000,
      });
    });

    it('preço reduzido calculado < 1 centavo impede a inicialização', () => {
      expect(() =>
        parseSponsorshipConfig({
          SPONSORSHIP_PRICE_FLOOR_CENTS: '1',
          SPONSORSHIP_STANDARD_PRICE_SIDE_CENTS: '1',
        }),
      ).toThrow(InvalidSponsorshipConfigError);
    });
  });
});
