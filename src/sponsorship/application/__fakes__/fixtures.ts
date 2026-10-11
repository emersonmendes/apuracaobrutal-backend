import type { AsaasConfig, SponsorshipConfig } from '../../domain/sponsorship-config';
import type { CandidateNames } from '../../domain/ports/candidate-names';
import type { Clock } from '../../domain/ports/clock';

export const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

/** CPF válido de teste (só para fixtures; não identifica ninguém). */
export const TEST_CPF = '52998224725';

export function asaasConfig(overrides: Partial<AsaasConfig> = {}): AsaasConfig {
  return {
    environment: 'sandbox',
    baseUrl: 'https://api-sandbox.asaas.com/v3',
    apiKey: '$aact_test_key',
    webhookToken: 'whsec_0123456789abcdef0123456789abcdef',
    timeoutMs: 10_000,
    ...overrides,
  };
}

export function testConfig(overrides: Partial<SponsorshipConfig> = {}): SponsorshipConfig {
  return {
    gateway: 'simulated',
    asaas: null,
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
    storageDir: '/tmp/unused',
    createLimitPerHour: 10,
    moderation: { maxAttempts: 3, minConfidence: 0.85, maxPerHour: 200 },
    ...overrides,
  };
}

/** Config com o gateway Asaas em sandbox. */
export function asaasTestConfig(overrides: Partial<SponsorshipConfig> = {}): SponsorshipConfig {
  return testConfig({ gateway: 'asaas', asaas: asaasConfig(), ...overrides });
}

/** Relógio controlável. */
export class FakeClock implements Clock {
  constructor(public current = new Date('2026-10-25T23:00:00.000Z')) {}
  now() {
    return new Date(this.current);
  }
  advance(ms: number) {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** Nomes de urna falsos (sponsorship-image-moderation D-6). */
export class FakeCandidateNames implements CandidateNames {
  constructor(public names: string[] = ['Lula', 'Flávio Bolsonaro']) {}
  async ballotNames(): Promise<string[]> {
    return [...this.names];
  }
}
