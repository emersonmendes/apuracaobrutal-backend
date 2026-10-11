import {
  applyModerationResult,
  canReceivePayment,
  isFinalRejection,
  moderationExpiryReason,
  nextAttemptDelay,
  publishable,
} from './moderation-state';

const now = new Date('2026-10-25T23:00:00.000Z');

describe('moderation-state — spec sponsorship-image-moderation R-2, R-5, R-7', () => {
  it('backoff: 10 s após a 1ª falha, 40 s após a 2ª, 60 s em 429 (R-5)', () => {
    expect(nextAttemptDelay(1, 'timeout')).toBe(10_000);
    expect(nextAttemptDelay(2, 'provider_unavailable')).toBe(40_000);
    expect(nextAttemptDelay(3, 'internal')).toBe(40_000);
    expect(nextAttemptDelay(1, 'rate_limited')).toBe(60_000);
  });

  it('aprovada: só moderation, moderatedAt e tentativas; status intacto (AC-14)', () => {
    const writes = applyModerationResult(
      { moderationAttempts: 0 },
      { outcome: 'approved' },
      now,
      3,
    );
    expect(writes).toEqual({
      moderation: 'approved',
      moderationAttempts: 1,
      moderationNextAttemptAt: null,
      moderationClaimedUntil: null,
      moderatedAt: now,
    });
    expect(writes).not.toHaveProperty('status');
    expect(isFinalRejection(writes)).toBe(false);
  });

  it('recusada: expira com motivo, categorias e solta a imagem (AC-14)', () => {
    const writes = applyModerationResult(
      { moderationAttempts: 0 },
      { outcome: 'rejected', categories: ['ELECTORAL_PROPAGANDA'] },
      now,
      3,
    );
    expect(writes).toEqual({
      moderation: 'rejected',
      moderationAttempts: 1,
      moderationNextAttemptAt: null,
      moderationClaimedUntil: null,
      moderatedAt: now,
      moderationCategories: ['ELECTORAL_PROPAGANDA'],
      status: 'expired',
      expiryReason: 'moderation_rejected',
      imageKey: null,
    });
    expect(isFinalRejection(writes)).toBe(true);
  });

  it('falha com tentativas restantes: continua pending com a próxima tentativa agendada (AC-06)', () => {
    const first = applyModerationResult(
      { moderationAttempts: 0 },
      { outcome: 'error', errorCode: 'timeout' },
      now,
      3,
    );
    expect(first).toEqual({
      moderation: 'pending',
      moderationAttempts: 1,
      moderationNextAttemptAt: new Date(now.getTime() + 10_000),
      moderationClaimedUntil: null,
    });
    const second = applyModerationResult(
      { moderationAttempts: 1 },
      { outcome: 'error', errorCode: 'rate_limited' },
      now,
      3,
    );
    expect(second.moderationNextAttemptAt).toEqual(new Date(now.getTime() + 60_000));
  });

  it('3ª falha → error definitivo, expirado, sem imagem (AC-06, cenário 21)', () => {
    const writes = applyModerationResult(
      { moderationAttempts: 2 },
      { outcome: 'error', errorCode: 'provider_unavailable' },
      now,
      3,
    );
    expect(writes).toMatchObject({
      moderation: 'error',
      moderationAttempts: 3,
      status: 'expired',
      expiryReason: 'moderation_error',
      imageKey: null,
      moderationCategories: [],
    });
    expect(isFinalRejection(writes)).toBe(true);
  });

  it('gate de pagamento por estado (R-7)', () => {
    expect(canReceivePayment({ moderation: 'approved' })).toBe('ok');
    expect(canReceivePayment({ moderation: 'pending' })).toBe('moderation_pending');
    expect(canReceivePayment({ moderation: 'rejected' })).toBe('moderation_rejected');
    expect(canReceivePayment({ moderation: 'error' })).toBe('moderation_error');
  });

  it('motivo de expiração de pagamento recebido sem aprovação (R-7)', () => {
    expect(moderationExpiryReason({ moderation: 'pending' })).toBe('moderation_pending');
    expect(moderationExpiryReason({ moderation: 'rejected' })).toBe('moderation_rejected');
    expect(moderationExpiryReason({ moderation: 'error' })).toBe('moderation_error');
  });

  it('publicável só quando pago, aprovado e com imagem e hash (R-7)', () => {
    const base = {
      status: 'scheduled' as const,
      moderation: 'approved' as const,
      imageKey: 'a.webp',
      imageSha256: 'h',
    };
    expect(publishable(base)).toBe(true);
    expect(publishable({ ...base, status: 'pending_payment' })).toBe(false);
    expect(publishable({ ...base, moderation: 'pending' })).toBe(false);
    expect(publishable({ ...base, moderation: 'rejected' })).toBe(false);
    expect(publishable({ ...base, imageKey: null })).toBe(false);
    expect(publishable({ ...base, imageSha256: null })).toBe(false);
  });
});
