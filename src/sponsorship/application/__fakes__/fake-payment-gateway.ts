import type { PaymentGateway } from '../../domain/ports/payment-gateway';

export class FakePaymentGateway implements PaymentGateway {
  readonly name = 'simulated' as const;
  readonly charges: { sponsorshipId: string; amountCents: number }[] = [];

  async createCharge(args: { sponsorshipId: string; amountCents: number }) {
    this.charges.push({ sponsorshipId: args.sponsorshipId, amountCents: args.amountCents });
    return { chargeId: `sim_${args.sponsorshipId}` };
  }
}
