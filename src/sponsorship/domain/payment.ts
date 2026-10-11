// Pagamento real (spec asaas-payment R-5, R-7): decisões sobre um pagamento recebido e sobre o
// estorno. Puro — sem NestJS, Prisma nem relógio.
import type { Sponsorship } from './scheduling';

export type PaymentMethod = 'pix' | 'credit_card' | 'other';
export type RefundState = 'none' | 'requested' | 'done' | 'failed';
export type ExpiryReason =
  | 'payment_timeout'
  | 'price_changed'
  | 'moderation_rejected'
  | 'moderation_error'
  | 'moderation_pending';

/** Pagamento informado pelo gateway (webhook ou consulta), já traduzido pelo adapter. */
export interface ReceivedPayment {
  chargeId: string;
  amountCents: number;
  method: PaymentMethod;
}

/** `billingType` do Asaas → forma de pagamento do pedido (R-5). */
export function methodFromBillingType(billingType: unknown): PaymentMethod {
  if (billingType === 'PIX') return 'pix';
  if (billingType === 'CREDIT_CARD') return 'credit_card';
  return 'other';
}

/** Valor em reais (decimal) → centavos inteiros; `null` se não for um número finito. */
export function amountCentsFromValue(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/** O pagamento informado é da cobrança deste pedido e no valor certo? (R-5) */
export function paymentMatches(
  order: Pick<Sponsorship, 'chargeId' | 'amountCents'>,
  received: Pick<ReceivedPayment, 'chargeId' | 'amountCents'>,
): boolean {
  return order.chargeId === received.chargeId && order.amountCents === received.amountCents;
}

/**
 * Campos gravados quando um pedido **não** pode ser agendado (R-5). Com pagamento recebido, o
 * dinheiro precisa voltar: `refund = requested` (uma vez; nunca regride um estorno já feito).
 */
export function expiryWrites(
  order: Pick<Sponsorship, 'expiryReason' | 'refund' | 'paidAt' | 'paymentMethod'>,
  reason: ExpiryReason,
  received: ReceivedPayment | undefined,
  now: Date,
): Pick<Sponsorship, 'status' | 'expiryReason' | 'refund' | 'paidAt' | 'paymentMethod'> {
  const base = {
    status: 'expired' as const,
    expiryReason: order.expiryReason ?? reason,
    refund: order.refund,
    paidAt: order.paidAt,
    paymentMethod: order.paymentMethod,
  };
  if (!received) return base;
  return {
    ...base,
    refund: order.refund === 'none' ? 'requested' : order.refund,
    paidAt: order.paidAt ?? now,
    paymentMethod: order.paymentMethod ?? received.method,
  };
}

/** Campos gravados ao agendar (sponsorships R-5) — com pagamento real, registra quando e como. */
export function scheduleWrites(
  window: { startsAt: Date; endsAt: Date },
  received: ReceivedPayment | undefined,
  now: Date,
): Pick<Sponsorship, 'status' | 'confirmedAt' | 'startsAt' | 'endsAt'> &
  Partial<Pick<Sponsorship, 'paidAt' | 'paymentMethod'>> {
  const base = { status: 'scheduled' as const, confirmedAt: now, ...window };
  return received ? { ...base, paidAt: now, paymentMethod: received.method } : base;
}

/** Depois desta tentativa o estorno vira `failed` (R-7). */
export const REFUND_MAX_ATTEMPTS = 20;

/** Estado do estorno depois de uma tentativa: `attempts` já conta a tentativa atual (R-7). */
export function nextRefundState(attempts: number, ok: boolean): RefundState {
  if (ok) return 'done';
  return attempts >= REFUND_MAX_ATTEMPTS ? 'failed' : 'requested';
}
