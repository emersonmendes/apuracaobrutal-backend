import type { SponsorshipConfig } from '../../domain/sponsorship-config';
import type { Clock } from '../../domain/ports/clock';

export const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

export function testConfig(overrides: Partial<SponsorshipConfig> = {}): SponsorshipConfig {
  return {
    gateway: 'simulated',
    production: false,
    pricesCents: { floor: 500_000, center: 300_000, glove: 200_000, side: 100_000 },
    maxMinutes: 60,
    leadSeconds: 60,
    paymentTtlMinutes: 30,
    imageMaxBytes: 2_097_152,
    storageDir: '/tmp/unused',
    createLimitPerHour: 10,
    ...overrides,
  };
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
