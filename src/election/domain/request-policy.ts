// Consumo respeitoso do TSE (spec election-results-feed R-11).
import type { Scope } from './election-config';

export const MAX_CONCURRENT_REQUESTS = 4;
export const NOT_FOUND_BACKOFF_MS = 300 * 1000;
export const BLOCKED_PAUSE_MS = 11 * 60 * 1000;

export function isBlocked(blockedUntil: Date | null, now: Date): boolean {
  return blockedUntil !== null && blockedUntil.getTime() > now.getTime();
}

/** Escopos a consultar no ciclo: exclui os que estão em recuo após `404`. */
export function scopesToRequest(
  scopes: readonly Scope[],
  notFoundUntil: (scope: Scope) => Date | null,
  now: Date,
): Scope[] {
  return scopes.filter((scope) => !isBlocked(notFoundUntil(scope), now));
}

export function nextNotFoundUntil(now: Date): Date {
  return new Date(now.getTime() + NOT_FOUND_BACKOFF_MS);
}

export function nextBlockedUntil(now: Date): Date {
  return new Date(now.getTime() + BLOCKED_PAUSE_MS);
}
