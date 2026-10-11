import { nextRefundState } from '../domain/payment';
import type { Clock } from '../domain/ports/clock';
import type { PaymentGateway } from '../domain/ports/payment-gateway';
import type { SponsorshipRepository } from '../domain/ports/sponsorship-repository';

/** Pedidos processados por execução. */
export const REFUND_BATCH = 50;
export const REFUND_REASON = 'Patrocínio não agendado';

interface Logger {
  warn(message: string): void;
  error(message: string): void;
}

/**
 * Estornos pendentes (spec asaas-payment R-7, Fluxo 5): cada pedido com `refund = requested` é
 * estornado integralmente no gateway; falha conta uma tentativa e fica para a próxima execução;
 * na 20ª falha o pedido vira `failed` (ação manual). Fora de transação: um pedido por vez.
 */
export class ProcessPaymentRefunds {
  constructor(
    private readonly repository: SponsorshipRepository,
    private readonly gateway: PaymentGateway,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  async execute(): Promise<{ done: number; retried: number; failed: number }> {
    const result = { done: 0, retried: 0, failed: 0 };
    if (this.gateway.name !== 'asaas') return result;

    for (const order of await this.repository.refundsRequested(REFUND_BATCH)) {
      if (order.paymentGateway !== this.gateway.name) continue;
      const attempts = order.refundAttempts + 1;
      let ok = false;
      try {
        await this.gateway.refund(order.chargeId, order.amountCents, REFUND_REASON);
        ok = true;
      } catch (error) {
        this.logger.warn(
          `estorno do pedido ${order.id} falhou (tentativa ${attempts}): ${String(error)}`,
        );
      }
      const refund = nextRefundState(attempts, ok);
      await this.repository.markRefund(order.id, {
        refund,
        refundAttempts: attempts,
        refundedAt: ok ? this.clock.now() : null,
      });
      if (refund === 'done') result.done++;
      else if (refund === 'failed') {
        result.failed++;
        this.logger.error(`estorno do pedido ${order.id} desistiu após ${attempts} tentativas`);
      } else result.retried++;
    }
    return result;
  }
}
