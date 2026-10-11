import {
  effectiveStatus,
  startsInMinutes,
  type Sponsorship,
  type SponsorshipStatus,
} from '../domain/scheduling';
import type { PriceTier } from '../domain/pricing';
import type { SponsorshipSlot } from '../domain/slots';

/** Visão pública de um pedido (FR-03): nunca inclui nome nem e-mail do anunciante (R-8). */
export interface PublicSponsorship {
  id: string;
  slot: SponsorshipSlot;
  minutes: number;
  priceTier: PriceTier;
  unitPriceCents: number;
  amountCents: number;
  status: SponsorshipStatus;
  paymentExpiresAt: Date;
  payment: { gateway: string };
  confirmedAt?: Date;
  startsAt?: Date;
  endsAt?: Date;
  startsInMinutes?: number;
}

export function toPublic(order: Sponsorship, now: Date): PublicSponsorship {
  const status = effectiveStatus(order, now);
  const base: PublicSponsorship = {
    id: order.id,
    slot: order.slot,
    minutes: order.minutes,
    priceTier: order.priceTier,
    unitPriceCents: order.unitPriceCents,
    amountCents: order.amountCents,
    status,
    paymentExpiresAt: order.paymentExpiresAt,
    payment: { gateway: order.paymentGateway },
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
