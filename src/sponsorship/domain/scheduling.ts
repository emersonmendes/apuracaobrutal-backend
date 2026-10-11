import type { Quote } from './pricing';
import type { SponsorshipSlot } from './slots';
import type { OrderInput } from './validation';

export type SponsorshipStatus = 'pending_payment' | 'scheduled' | 'expired';

export interface Sponsorship {
  id: string;
  slot: SponsorshipSlot;
  minutes: number;
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
 * Janela no ar (R-5): começa em `max(agora + LEAD, fim da fila do local)` e dura `minutes`.
 */
export function schedule(
  now: Date,
  minutes: number,
  queueEnd: Date | null,
  leadSeconds: number,
): { startsAt: Date; endsAt: Date } {
  const earliest = now.getTime() + leadSeconds * 1000;
  const start = Math.max(earliest, queueEnd?.getTime() ?? 0);
  return { startsAt: new Date(start), endsAt: new Date(start + minutes * MINUTE_MS) };
}

/** "Entra em X minutos" = minutos inteiros arredondados para cima (R-6). */
export function startsInMinutes(confirmedAt: Date, startsAt: Date): number {
  return Math.ceil((startsAt.getTime() - confirmedAt.getTime()) / MINUTE_MS);
}
