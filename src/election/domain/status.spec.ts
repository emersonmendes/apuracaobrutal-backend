import { makeResult, SIDES } from './__fixtures__/scope-result.builder';
import { computeSourceStatus } from './source-health';
import { deriveStatus, ufShares } from './status';
import {
  BLOCKED_PAUSE_MS,
  isBlocked,
  nextBlockedUntil,
  nextNotFoundUntil,
  NOT_FOUND_BACKOFF_MS,
  scopesToRequest,
} from './request-policy';

describe('deriveStatus (R-6, AC-06)', () => {
  it('tf = s com um eleito → final + winnerId', () => {
    expect(deriveStatus(makeResult({ final: true, redElected: true }), SIDES)).toEqual({
      status: 'final',
      winnerId: '280002542548',
    });
  });

  it('tf = s com esae = s → final sem vencedor', () => {
    expect(
      deriveStatus(makeResult({ final: true, redElected: true, noWinnerAssigned: true }), SIDES),
    ).toEqual({ status: 'final', winnerId: null });
  });

  it('tf = s com dois "eleitos" (inconsistente) → final sem vencedor', () => {
    expect(
      deriveStatus(makeResult({ final: true, redElected: true, blueElected: true }), SIDES),
    ).toEqual({ status: 'final', winnerId: null });
  });

  it('nunca escolhe vencedor pelos votos', () => {
    expect(deriveStatus(makeResult({ final: true, redPct: 60, bluePct: 40 }), SIDES).winnerId).toBe(
      null,
    );
  });

  it('dv = n → not_started', () => {
    expect(deriveStatus(makeResult({ disclosable: false }), SIDES).status).toBe('not_started');
  });

  it('and = n → not_started', () => {
    expect(deriveStatus(makeResult({ progress: 'n' }), SIDES).status).toBe('not_started');
  });

  it.each(['p', 'f'] as const)('and = %s sem tf → partial', (progress) => {
    expect(deriveStatus(makeResult({ progress }), SIDES)).toEqual({
      status: 'partial',
      winnerId: null,
    });
  });
});

describe('ufShares (R-6)', () => {
  it('UF divulgável → percentuais do TSE', () => {
    expect(ufShares(makeResult({ scope: 'sp', redPct: 41.2, bluePct: 58.8 }), SIDES)).toEqual({
      redPct: 41.2,
      bluePct: 58.8,
    });
  });

  it.each([
    ['dv = n', { disclosable: false }],
    ['and = n', { progress: 'n' as const }],
    ['vv = 0', { validVotes: 0 }],
  ])('%s → null', (_label, overrides) => {
    expect(ufShares(makeResult({ scope: 'sp', ...overrides }), SIDES)).toBeNull();
  });
});

describe('computeSourceStatus (R-10, AC-11)', () => {
  const now = new Date('2026-10-25T23:00:00Z');
  it('nunca houve sucesso → failed', () => {
    expect(computeSourceStatus(null, now, 90)).toBe('failed');
  });
  it('exatamente na janela → ok; um ms além → failed', () => {
    expect(computeSourceStatus(new Date(now.getTime() - 90_000), now, 90)).toBe('ok');
    expect(computeSourceStatus(new Date(now.getTime() - 90_001), now, 90)).toBe('failed');
  });
});

describe('política de requisições (R-11, AC-12)', () => {
  const now = new Date('2026-10-25T23:00:00Z');

  it('recuos de 300 s (404) e 11 min (bloqueio)', () => {
    expect(nextNotFoundUntil(now).getTime() - now.getTime()).toBe(NOT_FOUND_BACKOFF_MS);
    expect(NOT_FOUND_BACKOFF_MS).toBe(300_000);
    expect(nextBlockedUntil(now).getTime() - now.getTime()).toBe(BLOCKED_PAUSE_MS);
    expect(BLOCKED_PAUSE_MS).toBe(660_000);
  });

  it('isBlocked só enquanto o prazo não passou', () => {
    expect(isBlocked(null, now)).toBe(false);
    expect(isBlocked(new Date(now.getTime() + 1), now)).toBe(true);
    expect(isBlocked(now, now)).toBe(false);
  });

  it('scopesToRequest exclui escopos em recuo', () => {
    const until = new Map([['sp', new Date(now.getTime() + 1000)]]);
    expect(scopesToRequest(['br', 'sp', 'rj'], (s) => until.get(s) ?? null, now)).toEqual([
      'br',
      'rj',
    ]);
  });
});
