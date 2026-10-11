import {
  amountCentsFromValue,
  methodFromBillingType,
  paymentMatches,
  type ReceivedPayment,
} from '../domain/payment';
import type { Clock } from '../domain/ports/clock';
import type {
  PaymentWebhookOutcome,
  SponsorshipRepository,
} from '../domain/ports/sponsorship-repository';
import type { ConfirmPayment } from './confirm-payment';

/** Evento já autenticado e com `id`/`event` de texto (o controller garante). */
export interface AsaasWebhookEvent {
  id: string;
  event: string;
  payment?: unknown;
  [extra: string]: unknown;
}

const PAID_EVENTS = new Set(['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Webhook do Asaas (spec asaas-payment R-6, Fluxo 3): grava o evento e aplica o efeito na mesma
 * transação; `id` repetido não reprocessa. Nunca chama o gateway. O pedido é localizado por
 * `payment.externalReference` e conferido por `payment.id` e valor (R-5).
 */
export class HandleAsaasWebhook {
  constructor(
    private readonly repository: SponsorshipRepository,
    private readonly confirm: ConfirmPayment,
    private readonly clock: Clock,
  ) {}

  async execute(event: AsaasWebhookEvent): Promise<PaymentWebhookOutcome | 'duplicate'> {
    const payment = isObject(event.payment) ? event.payment : {};
    const chargeId = typeof payment.id === 'string' ? payment.id : null;
    const reference =
      typeof payment.externalReference === 'string' ? payment.externalReference : null;
    const sponsorshipId = reference && UUID.test(reference) ? reference : null;

    // Auditoria por allow-list: o `creditCard` (token, bandeira, 4 últimos) nunca é persistido
    // (asaas-payment FR-02).
    const safePayment = Object.fromEntries(
      Object.entries(payment).filter(([key]) => key !== 'creditCard'),
    );
    const payload = isObject(event.payment) ? { ...event, payment: safePayment } : event;

    return this.repository.recordWebhookEvent(
      {
        id: event.id,
        gateway: 'asaas',
        event: event.event,
        chargeId,
        sponsorshipId,
        receivedAt: this.clock.now(),
        payload,
      },
      (repository) => this.apply(repository, event.event, payment, chargeId, sponsorshipId),
    );
  }

  private async apply(
    repository: SponsorshipRepository,
    event: string,
    payment: Record<string, unknown>,
    chargeId: string | null,
    sponsorshipId: string | null,
  ): Promise<PaymentWebhookOutcome> {
    if (PAID_EVENTS.has(event)) {
      const amountCents = amountCentsFromValue(payment.value);
      if (!chargeId || !sponsorshipId || amountCents === null) return 'rejected';
      const order = await repository.findById(sponsorshipId);
      if (!order || order.paymentGateway !== 'asaas') return 'rejected';
      const received: ReceivedPayment = {
        chargeId,
        amountCents,
        method: methodFromBillingType(payment.billingType),
      };
      if (!paymentMatches(order, received)) return 'rejected';
      const outcome = await this.confirm.confirmReceived(order.id, received, repository);
      if (outcome.kind === 'scheduled') return 'scheduled';
      if (outcome.kind === 'not_found' || outcome.kind === 'not_approved') return 'rejected';
      return outcome.refundRequested ? 'refund_requested' : 'rejected';
    }
    if (event === 'PAYMENT_REFUNDED') {
      if (!chargeId) return 'rejected';
      const id = await repository.markRefundDoneByCharge('asaas', chargeId, this.clock.now());
      return id ? 'refund_done' : 'rejected';
    }
    return 'ignored';
  }
}
