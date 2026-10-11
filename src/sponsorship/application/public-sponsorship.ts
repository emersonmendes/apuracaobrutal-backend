import type { ModerationCategory } from '../../moderation/domain/categories';
import type { ModerationState } from '../domain/moderation-state';
import type { PaymentMethod, RefundState } from '../domain/payment';
import {
  effectiveStatus,
  startsInMinutes,
  type Sponsorship,
  type SponsorshipStatus,
} from '../domain/scheduling';
import type { PriceTier } from '../domain/pricing';
import type { SponsorshipSlot } from '../domain/slots';
import { sandboxPayments, type SponsorshipConfig } from '../domain/sponsorship-config';

/** Pagamento visto de fora (asaas-payment FR-03): nunca o CPF/CNPJ nem ids do gateway. */
export interface PublicPayment {
  gateway: string;
  sandbox: boolean;
  method: PaymentMethod | null;
  paidAt?: Date;
  refund: Exclude<RefundState, 'none'> | null;
}

/** Moderação vista de fora (sponsorship-image-moderation FR-03, R-10): só estado e categorias. */
export interface PublicModeration {
  status: ModerationState;
  /** Vazio fora de `rejected` (e numa recusa sem categoria). */
  categories: ModerationCategory[];
}

/** Visão pública de um pedido (FR-03): nunca inclui nome, e-mail nem CPF/CNPJ (R-8). */
export interface PublicSponsorship {
  id: string;
  slot: SponsorshipSlot;
  minutes: number;
  priceTier: PriceTier;
  unitPriceCents: number;
  amountCents: number;
  status: SponsorshipStatus;
  paymentExpiresAt: Date;
  payment: PublicPayment;
  moderation: PublicModeration;
  confirmedAt?: Date;
  startsAt?: Date;
  endsAt?: Date;
  startsInMinutes?: number;
}

export function toPublic(
  order: Sponsorship,
  now: Date,
  config: Pick<SponsorshipConfig, 'gateway' | 'asaas'>,
): PublicSponsorship {
  const status = effectiveStatus(order, now);
  const payment: PublicPayment = {
    gateway: order.paymentGateway,
    sandbox: order.paymentGateway === 'simulated' || sandboxPayments(config),
    method: order.paymentMethod,
    refund: order.refund === 'none' ? null : order.refund,
  };
  if (order.paidAt) payment.paidAt = order.paidAt;
  const base: PublicSponsorship = {
    id: order.id,
    slot: order.slot,
    minutes: order.minutes,
    priceTier: order.priceTier,
    unitPriceCents: order.unitPriceCents,
    amountCents: order.amountCents,
    status,
    paymentExpiresAt: order.paymentExpiresAt,
    payment,
    moderation: {
      status: order.moderation,
      categories: order.moderation === 'rejected' ? [...order.moderationCategories] : [],
    },
  };
  if (status !== 'scheduled' || !order.confirmedAt || !order.startsAt || !order.endsAt) return base;
  return {
    ...base,
    confirmedAt: order.confirmedAt,
    startsAt: order.startsAt,
    endsAt: order.endsAt,
    startsInMinutes: startsInMinutes(order.confirmedAt, order.startsAt),
  };
}
