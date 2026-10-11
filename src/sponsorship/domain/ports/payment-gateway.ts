/** Porta de cobrança (spec sponsorships R-9). Único adapter atual: simulado. */
export interface PaymentGateway {
  readonly name: 'simulated';
  createCharge(args: {
    sponsorshipId: string;
    amountCents: number;
    description: string;
  }): Promise<{ chargeId: string }>;
}

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');
