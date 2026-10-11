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
  imageKey: string | null;
  status: SponsorshipStatus;
  paymentGateway: string;
  chargeId: string;
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
  gateway: string;
  chargeId: string;
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
    imageKey: args.imageKey,
    status: 'pending_payment',
    paymentGateway: args.gateway,
    chargeId: args.chargeId,
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
