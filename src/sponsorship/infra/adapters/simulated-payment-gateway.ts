import { randomUUID } from 'node:crypto';
import type {
  ChargeStatus,
  CreatedCharge,
  PaymentGateway,
  PixQrCode,
} from '../../domain/ports/payment-gateway';

/**
 * Gateway SIMULADO (spec sponsorships R-9): cobrança fictícia, confirmada só pela ação explícita
 * `Pagar (simulado)`. Nenhum dinheiro real é movimentado; bloqueado em produção. As operações do
 * gateway real (asaas-payment FR-04) existem só para cumprir a porta e não fazem nada.
 */
export class SimulatedPaymentGateway implements PaymentGateway {
  readonly name = 'simulated' as const;
  readonly sandbox = true;

  async createCharge(): Promise<CreatedCharge> {
    return { chargeId: `sim_${randomUUID()}`, customerId: null, invoiceUrl: null };
  }

  async getPixQrCode(): Promise<PixQrCode> {
    return { qrCodeImage: '', payload: '' };
  }

  async getChargeStatus(): Promise<ChargeStatus> {
    return { state: 'pending', method: null };
  }

  async refund(): Promise<{ state: 'done' | 'already_refunded' }> {
    return { state: 'done' };
  }

  async cancelCharge(): Promise<void> {
    return undefined;
  }
}
