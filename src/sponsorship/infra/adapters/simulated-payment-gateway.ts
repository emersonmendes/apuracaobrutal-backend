import { randomUUID } from 'node:crypto';
import type { PaymentGateway } from '../../domain/ports/payment-gateway';

/**
 * Gateway SIMULADO (spec sponsorships R-9): cobrança fictícia, confirmada só pela ação explícita
 * `Pagar (simulado)`. Nenhum dinheiro real é movimentado; bloqueado em produção.
 */
export class SimulatedPaymentGateway implements PaymentGateway {
  readonly name = 'simulated' as const;

  async createCharge(): Promise<{ chargeId: string }> {
    return { chargeId: `sim_${randomUUID()}` };
  }
}
