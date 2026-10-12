import type { ModerationCategory } from '../../moderation/domain/categories';
import type { ModerationState } from './moderation-state';
import type { ExpiryReason, PaymentMethod, RefundState } from './payment';
import { priceTierOf, type PriceTier, type Quote } from './pricing';
import type { ElectionDay } from './sponsorship-config';
import type { SponsorshipSlot } from './slots';
import type { OrderInput } from './validation';

export type SponsorshipStatus = 'pending_payment' | 'scheduled' | 'expired';

export interface Sponsorship {
  id: string;
  slot: SponsorshipSlot;
  minutes: number;
  priceTier: PriceTier;
  unitPriceCents: number;
  amountCents: number;
  advertiserName: string;
  email: string;
  /** Só dígitos (asaas-payment R-2); `null` em pedidos anteriores à cobrança real. */
  cpfCnpj: string | null;
  /** Link opcional do anúncio (sponsor-link R-1). */
  linkUrl: string | null;
  imageKey: string | null;
  /** SHA-256 (hex) do WebP gravado: a imagem analisada é a publicada (sponsorship-image-moderation R-6). */
  imageSha256: string | null;
  status: SponsorshipStatus;
  /** Moderação automática (sponsorship-image-moderation R-2). Independente de `status`. */
  moderation: ModerationState;
  moderationAttempts: number;
  moderationNextAttemptAt: Date | null;
  moderationClaimedUntil: Date | null;
  moderatedAt: Date | null;
  moderationCategories: ModerationCategory[];
  paymentGateway: string;
  chargeId: string;
  gatewayCustomerId: string | null;
  invoiceUrl: string | null;
  paymentMethod: PaymentMethod | null;
  paidAt: Date | null;
  refund: RefundState;
  refundAttempts: number;
  refundedAt: Date | null;
  expiryReason: ExpiryReason | null;
  createdAt: Date;
  paymentExpiresAt: Date;
  confirmedAt: Date | null;
  startsAt: Date | null;
  endsAt: Date | null;
}

const MINUTE_MS = 60_000;

/** Pedido novo: `pending_payment`, preço congelado, validade do pagamento (R-3, R-4). */
export function newPendingOrder(args: {
  id: string;
  input: OrderInput;
  quote: Quote;
  imageKey: string;
  imageSha256: string;
  gateway: string;
  chargeId: string;
  gatewayCustomerId?: string | null;
  invoiceUrl?: string | null;
  now: Date;
  paymentTtlMinutes: number;
}): Sponsorship {
  return {
    id: args.id,
    slot: args.input.slot,
    minutes: args.input.minutes,
    priceTier: args.quote.priceTier,
    unitPriceCents: args.quote.unitPriceCents,
    amountCents: args.quote.amountCents,
    advertiserName: args.input.advertiserName,
    email: args.input.email,
    cpfCnpj: args.input.cpfCnpj,
    linkUrl: args.input.linkUrl ?? null,
    imageKey: args.imageKey,
    imageSha256: args.imageSha256,
    status: 'pending_payment',
    moderation: 'pending',
    moderationAttempts: 0,
    moderationNextAttemptAt: args.now,
    moderationClaimedUntil: null,
    moderatedAt: null,
    moderationCategories: [],
    paymentGateway: args.gateway,
    chargeId: args.chargeId,
    gatewayCustomerId: args.gatewayCustomerId ?? null,
    invoiceUrl: args.invoiceUrl ?? null,
    paymentMethod: null,
    paidAt: null,
    refund: 'none',
    refundAttempts: 0,
    refundedAt: null,
    expiryReason: null,
    createdAt: args.now,
    paymentExpiresAt: new Date(args.now.getTime() + args.paymentTtlMinutes * MINUTE_MS),
    confirmedAt: null,
    startsAt: null,
    endsAt: null,
  };
}

/** Pagamento venceu? (R-4) */
export function paymentExpired(order: Pick<Sponsorship, 'paymentExpiresAt'>, now: Date): boolean {
  return now.getTime() >= order.paymentExpiresAt.getTime();
}

/**
 * Vencido por prazo na confirmação (R-9): já `expired` sem motivo de moderação, ou prazo de
 * pagamento passado. Tem precedência sobre `moderation = pending`; recusa/erro de moderação já
 * expiraram o pedido e respondem pelo próprio motivo (sponsorship-image-moderation R-7).
 */
export function expiredByDeadline(
  order: Pick<Sponsorship, 'status' | 'paymentExpiresAt' | 'moderation'>,
  now: Date,
): boolean {
  if (order.moderation === 'rejected' || order.moderation === 'error') return false;
  return order.status === 'expired' || paymentExpired(order, now);
}

/** Status visto de fora: um pendente vencido já é `expired` (R-4). */
export function effectiveStatus(
  order: Pick<Sponsorship, 'status' | 'paymentExpiresAt'>,
  now: Date,
): SponsorshipStatus {
  return order.status === 'pending_payment' && paymentExpired(order, now)
    ? 'expired'
    : order.status;
}

/**
 * Janela no ar (R-5): começa em `max(agora, fim da fila do local)` — local livre entra no ar no
 * instante do pagamento — e dura `minutes`.
 */
export function schedule(
  now: Date,
  minutes: number,
  queueEnd: Date | null,
): { startsAt: Date; endsAt: Date } {
  const start = Math.max(now.getTime(), queueEnd?.getTime() ?? 0);
  return { startsAt: new Date(start), endsAt: new Date(start + minutes * MINUTE_MS) };
}

/** "Entra em X minutos" = minutos inteiros arredondados para cima; `0` = já no ar (R-6). */
export function startsInMinutes(confirmedAt: Date, startsAt: Date): number {
  return Math.ceil((startsAt.getTime() - confirmedAt.getTime()) / MINUTE_MS);
}

/**
 * A faixa da janela real (calculada na confirmação) é a mesma congelada no pedido? Se não, o
 * pagamento é recusado com `price_changed` (spec sponsorship-election-pricing R-5).
 */
export function confirmationTierMatches(
  order: Pick<Sponsorship, 'priceTier'>,
  window: { startsAt: Date; endsAt: Date },
  electionDay: Pick<ElectionDay, 'startsAt' | 'endsAt'>,
): boolean {
  return priceTierOf(window, electionDay) === order.priceTier;
}
