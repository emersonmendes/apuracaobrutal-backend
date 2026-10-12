import {
  InvalidSponsorshipConfigError,
  parseSponsorshipConfig,
  parseSponsorshipWorkerEnabled,
} from './sponsorship-config.factory';

describe('parseSponsorshipWorkerEnabled — spec sponsorships FR-01, FR-05 (AC-21)', () => {
  it('ausente ou vazio → ligado', () => {
    expect(parseSponsorshipWorkerEnabled({})).toBe(true);
    expect(parseSponsorshipWorkerEnabled({ SPONSORSHIP_WORKER_ENABLED: ' ' })).toBe(true);
  });

  it('aceita true/false sem distinguir caixa', () => {
    expect(parseSponsorshipWorkerEnabled({ SPONSORSHIP_WORKER_ENABLED: 'false' })).toBe(false);
    expect(parseSponsorshipWorkerEnabled({ SPONSORSHIP_WORKER_ENABLED: 'FALSE' })).toBe(false);
    expect(parseSponsorshipWorkerEnabled({ SPONSORSHIP_WORKER_ENABLED: 'True' })).toBe(true);
  });

  it('qualquer outro valor → erro citando a variável', () => {
    expect(() => parseSponsorshipWorkerEnabled({ SPONSORSHIP_WORKER_ENABLED: 'off' })).toThrow(
      InvalidSponsorshipConfigError,
    );
    expect(() => parseSponsorshipWorkerEnabled({ SPONSORSHIP_WORKER_ENABLED: '0' })).toThrow(
      /SPONSORSHIP_WORKER_ENABLED/,
    );
  });
});

describe('parseSponsorshipConfig — spec sponsorships FR-01 (AC-01)', () => {
  it('usa os padrões da spec', () => {
    expect(parseSponsorshipConfig({})).toEqual({
      gateway: 'simulated',
      asaas: null,
      production: false,
      pricesCents: { floor: 400_000, center: 300_000, glove: 200_000, side: 100_000 },
      standardPricesCents: { floor: 2_000, center: 1_500, glove: 1_000, side: 500 },
      electionDay: {
        date: '2026-10-25',
        startsAt: new Date('2026-10-25T03:00:00.000Z'),
        endsAt: new Date('2026-10-26T03:00:00.000Z'),
      },
      maxMinutes: 60,
      paymentTtlMinutes: 30,
      imageMaxBytes: 3_145_728,
      storage: { kind: 'local', dir: './storage/sponsorships' },
      createLimitPerHour: 10,
      moderation: { maxAttempts: 3, maxPerHour: 200 },
    });
  });

  it('lê a política de moderação do ambiente (sponsorship-image-moderation FR-01, AC-01)', () => {
    expect(
      parseSponsorshipConfig({
        SPONSORSHIP_MODERATION_MAX_ATTEMPTS: '5',
        SPONSORSHIP_MODERATION_MAX_PER_HOUR: '50',
      }).moderation,
    ).toEqual({ maxAttempts: 5, maxPerHour: 50 });
  });

  it('lê os valores do ambiente e marca produção', () => {
    // Em produção o armazenamento local é recusado (sponsorship-s3-storage R-1).
    const config = parseSponsorshipConfig({
      NODE_ENV: 'production',
      SPONSORSHIP_STORAGE: 's3',
      SPONSORSHIP_S3_BUCKET: 'apuracaobrutal-prod-sponsorship-images',
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
    ['SPONSORSHIP_MODERATION_MAX_ATTEMPTS', '0'],
    ['SPONSORSHIP_MODERATION_MAX_ATTEMPTS', '6'],
    ['SPONSORSHIP_MODERATION_MAX_PER_HOUR', '0'],
  ])('%s=%s impede a inicialização', (name, raw) => {
    expect(() => parseSponsorshipConfig({ [name]: raw })).toThrow(InvalidSponsorshipConfigError);
  });

  describe('gateway asaas — spec asaas-payment FR-01, R-1 (AC-02)', () => {
    const KEY = '$aact_test_key_000000000000000000000000000000';
    const TOKEN = 'whsec_0123456789abcdef0123456789abcdef';
    const asaas = (overrides: Record<string, string | undefined> = {}) =>
      parseSponsorshipConfig({
        PAYMENT_GATEWAY: 'asaas',
        ASAAS_API_KEY: KEY,
        ASAAS_WEBHOOK_TOKEN: TOKEN,
        ...overrides,
      });

    it('sandbox por padrão, com a URL base do ambiente', () => {
      expect(asaas()).toMatchObject({
        gateway: 'asaas',
        asaas: {
          environment: 'sandbox',
          baseUrl: 'https://api-sandbox.asaas.com/v3',
          apiKey: KEY,
          webhookToken: TOKEN,
          timeoutMs: 10_000,
        },
      });
      expect(
        asaas({ ASAAS_ENVIRONMENT: 'production', ASAAS_TIMEOUT_MS: '2500' }).asaas,
      ).toMatchObject({
        environment: 'production',
        baseUrl: 'https://api.asaas.com/v3',
        timeoutMs: 2_500,
      });
    });

    it.each([
      ['sem chave', { ASAAS_API_KEY: '' }],
      ['sem token', { ASAAS_WEBHOOK_TOKEN: '' }],
      ['token curto', { ASAAS_WEBHOOK_TOKEN: 'curto' }],
      ['token com espaço', { ASAAS_WEBHOOK_TOKEN: `${TOKEN} com espaco` }],
      ['token igual à chave', { ASAAS_WEBHOOK_TOKEN: KEY, ASAAS_API_KEY: KEY }],
      ['ambiente desconhecido', { ASAAS_ENVIRONMENT: 'staging' }],
      ['timeout baixo', { ASAAS_TIMEOUT_MS: '999' }],
    ])('%s impede a inicialização', (_label, overrides) => {
      expect(() => asaas(overrides)).toThrow(InvalidSponsorshipConfigError);
    });

    it('a mensagem de erro nunca ecoa a chave', () => {
      expect(() => asaas({ ASAAS_WEBHOOK_TOKEN: KEY })).toThrow(
        expect.not.stringContaining(KEY) as unknown as string,
      );
    });

    it('com gateway simulado as variáveis ASAAS_* são ignoradas', () => {
      const config = parseSponsorshipConfig({ ASAAS_ENVIRONMENT: 'staging', ASAAS_API_KEY: '' });
      expect(config.gateway).toBe('simulated');
      expect(config.asaas).toBeNull();
    });
  });

  it('acumula todos os problemas', () => {
    try {
      parseSponsorshipConfig({ SPONSORSHIP_PRICE_FLOOR_CENTS: '0', SPONSORSHIP_MAX_MINUTES: 'x' });
      fail('deveria lançar');
    } catch (error) {
      expect((error as InvalidSponsorshipConfigError).problems).toHaveLength(2);
    }
  });

  describe('armazenamento — spec sponsorship-s3-storage FR-01 (AC-01)', () => {
    const s3 = (overrides: Record<string, string | undefined> = {}) =>
      parseSponsorshipConfig({
        SPONSORSHIP_STORAGE: 's3',
        SPONSORSHIP_S3_BUCKET: 'apuracaobrutal-prod-sponsorship-images',
        ...overrides,
      });

    it('padrão local com a pasta de SPONSORSHIP_STORAGE_DIR', () => {
      expect(parseSponsorshipConfig({ SPONSORSHIP_STORAGE_DIR: '/data/img' }).storage).toEqual({
        kind: 'local',
        dir: '/data/img',
      });
    });

    it('s3 devolve bucket, região, profile, endpoint e timeout (padrões e valores do ambiente)', () => {
      expect(s3().storage).toEqual({
        kind: 's3',
        bucket: 'apuracaobrutal-prod-sponsorship-images',
        region: 'us-east-1',
        profile: null,
        endpoint: null,
        timeoutMs: 10_000,
      });
      expect(
        s3({
          AWS_REGION: 'sa-east-1',
          AWS_PROFILE: 'puoro',
          SPONSORSHIP_S3_ENDPOINT: 'http://localhost:9000',
          SPONSORSHIP_S3_TIMEOUT_MS: '2500',
        }).storage,
      ).toEqual({
        kind: 's3',
        bucket: 'apuracaobrutal-prod-sponsorship-images',
        region: 'sa-east-1',
        profile: 'puoro',
        endpoint: 'http://localhost:9000',
        timeoutMs: 2_500,
      });
    });

    it.each([
      ['SPONSORSHIP_STORAGE', { SPONSORSHIP_STORAGE: 'disk' }],
      ['SPONSORSHIP_S3_BUCKET', { SPONSORSHIP_S3_BUCKET: '' }],
      ['SPONSORSHIP_S3_BUCKET', { SPONSORSHIP_S3_BUCKET: 'AB' }],
      ['SPONSORSHIP_S3_BUCKET', { SPONSORSHIP_S3_BUCKET: 'my_bucket' }],
      ['AWS_REGION', { AWS_REGION: 'x' }],
      ['SPONSORSHIP_S3_TIMEOUT_MS', { SPONSORSHIP_S3_TIMEOUT_MS: '999' }],
      ['SPONSORSHIP_S3_ENDPOINT', { SPONSORSHIP_S3_ENDPOINT: 'localhost:9000' }],
    ])('%s inválida impede a inicialização citando a variável', (name, overrides) => {
      expect(() => s3(overrides)).toThrow(InvalidSponsorshipConfigError);
      expect(() => s3(overrides)).toThrow(new RegExp(name));
    });

    it('local é recusado em produção (R-1); s3 é aceito', () => {
      expect(() => parseSponsorshipConfig({ NODE_ENV: 'production' })).toThrow(
        /SPONSORSHIP_STORAGE=local não é permitido/,
      );
      expect(s3({ NODE_ENV: 'production' }).storage.kind).toBe('s3');
    });

    it('endpoint alternativo é recusado em produção (R-4)', () => {
      expect(() =>
        s3({ NODE_ENV: 'production', SPONSORSHIP_S3_ENDPOINT: 'https://minio.interno' }),
      ).toThrow(/SPONSORSHIP_S3_ENDPOINT não é permitida/);
    });

    it('com local as SPONSORSHIP_S3_* são ignoradas', () => {
      expect(
        parseSponsorshipConfig({
          SPONSORSHIP_S3_BUCKET: 'AB',
          SPONSORSHIP_S3_TIMEOUT_MS: '1',
          SPONSORSHIP_S3_ENDPOINT: 'nada',
        }).storage.kind,
      ).toBe('local');
    });

    it('acumula com os demais problemas', () => {
      try {
        s3({ SPONSORSHIP_S3_BUCKET: '', SPONSORSHIP_MAX_MINUTES: 'x' });
        fail('deveria lançar');
      } catch (error) {
        expect((error as InvalidSponsorshipConfigError).problems).toHaveLength(2);
      }
    });
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
        floor: 2_000,
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
