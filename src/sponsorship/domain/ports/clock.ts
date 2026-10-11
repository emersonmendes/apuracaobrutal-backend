export interface Clock {
  now(): Date;
}

export const SPONSORSHIP_CLOCK = Symbol('SPONSORSHIP_CLOCK');

export const systemClock: Clock = { now: () => new Date() };
