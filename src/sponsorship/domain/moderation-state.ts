// Estado de moderação do pedido (spec sponsorship-image-moderation R-2, R-5, R-7). Puro — sem
// NestJS, Prisma nem SDK. Os tipos de categoria vêm do contrato do módulo `moderation` (só tipos).
import type { ModerationCategory } from '../../moderation/domain/categories';
import type { ExpiryReason } from './payment';
import type { Sponsorship } from './scheduling';

export type ModerationState = 'pending' | 'approved' | 'rejected' | 'error';

/** Códigos de falha de uma tentativa (R-5, R-6). */
export type ModerationErrorCode =
  | 'timeout'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'provider_rejected'
  | 'invalid_response'
  | 'internal'
  | 'image_missing'
  | 'image_mismatch';

/** Backoff após a 1ª e a 2ª falha (R-5). A partir daí repete o último valor. */
export const MODERATION_BACKOFF_MS: readonly number[] = [10_000, 40_000];
/** 429: espera fixa maior em qualquer tentativa (R-5). */
export const RATE_LIMIT_BACKOFF_MS = 60_000;

/** `failures` = falhas já contadas incluindo a atual (1 → 10 s, 2 → 40 s). */
export function nextAttemptDelay(failures: number, errorCode: ModerationErrorCode): number {
  if (errorCode === 'rate_limited') return RATE_LIMIT_BACKOFF_MS;
  const index = Math.min(Math.max(failures, 1), MODERATION_BACKOFF_MS.length) - 1;
  return MODERATION_BACKOFF_MS[index];
}

export type ModerationAttemptOutcome =
  | { outcome: 'approved' }
  | { outcome: 'rejected'; categories: ModerationCategory[] }
  | { outcome: 'error'; errorCode: ModerationErrorCode };

/** Campos gravados no pedido depois de uma tentativa (R-2). */
export interface ModerationWrites {
  moderation: ModerationState;
  moderationAttempts: number;
  moderationNextAttemptAt: Date | null;
  moderationClaimedUntil: null;
  moderatedAt?: Date;
  moderationCategories?: ModerationCategory[];
  status?: 'expired';
  expiryReason?: ExpiryReason;
  imageKey?: null;
}

/**
 * Desfecho de uma tentativa → escritas (R-2): aprovada só muda `moderation`; recusada e erro
 * definitivo expiram o pedido, registram o motivo e soltam a imagem; falha com tentativas
 * restantes agenda a próxima (R-5).
 */
export function applyModerationResult(
  order: Pick<Sponsorship, 'moderationAttempts'>,
  result: ModerationAttemptOutcome,
  now: Date,
  maxAttempts: number,
): ModerationWrites {
  const moderationAttempts = order.moderationAttempts + 1;
  const base = { moderationAttempts, moderationNextAttemptAt: null, moderationClaimedUntil: null };
  if (result.outcome === 'approved') {
    return { ...base, moderation: 'approved', moderatedAt: now };
  }
  if (result.outcome === 'rejected') {
    return {
      ...base,
      moderation: 'rejected',
      moderatedAt: now,
      moderationCategories: result.categories,
      status: 'expired',
      expiryReason: 'moderation_rejected',
      imageKey: null,
    };
  }
  if (moderationAttempts >= maxAttempts) {
    return {
      ...base,
      moderation: 'error',
      moderatedAt: now,
      moderationCategories: [],
      status: 'expired',
      expiryReason: 'moderation_error',
      imageKey: null,
    };
  }
  return {
    ...base,
    moderation: 'pending',
    moderationNextAttemptAt: new Date(
      now.getTime() + nextAttemptDelay(moderationAttempts, result.errorCode),
    ),
  };
}

/** A escrita é final (recusa ou erro definitivo)? Dispara a limpeza pós-transação (R-2). */
export function isFinalRejection(writes: ModerationWrites): boolean {
  return writes.moderation === 'rejected' || writes.moderation === 'error';
}

export type PaymentGateResult =
  'ok' | 'moderation_pending' | 'moderation_rejected' | 'moderation_error';

/** Gate de pagamento (R-7): só pedido aprovado recebe instruções ou confirmação. */
export function canReceivePayment(order: Pick<Sponsorship, 'moderation'>): PaymentGateResult {
  switch (order.moderation) {
    case 'approved':
      return 'ok';
    case 'pending':
      return 'moderation_pending';
    case 'rejected':
      return 'moderation_rejected';
    case 'error':
      return 'moderation_error';
  }
}

/** Motivo de expiração quando um pagamento real chega a um pedido não aprovado (R-7). */
export function moderationExpiryReason(
  order: Pick<Sponsorship, 'moderation'>,
): Extract<ExpiryReason, `moderation_${string}`> {
  if (order.moderation === 'rejected') return 'moderation_rejected';
  if (order.moderation === 'error') return 'moderation_error';
  return 'moderation_pending';
}

/** Publicável (R-7): pago, aprovado e com imagem. O hash é conferido na leitura (R-6). */
export function publishable(
  order: Pick<Sponsorship, 'status' | 'moderation' | 'imageKey' | 'imageSha256'>,
): boolean {
  return (
    order.status === 'scheduled' &&
    order.moderation === 'approved' &&
    order.imageKey !== null &&
    order.imageSha256 !== null
  );
}
