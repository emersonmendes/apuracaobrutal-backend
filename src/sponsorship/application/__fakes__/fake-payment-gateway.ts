import { GatewayError } from '../../domain/errors';
import type {
  ChargeStatus,
  CreateChargeArgs,
  CreatedCharge,
  PaymentGateway,
  PixQrCode,
} from '../../domain/ports/payment-gateway';
import type { PaymentGatewayName } from '../../domain/sponsorship-config';

type Method = 'createCharge' | 'getPixQrCode' | 'getChargeStatus' | 'refund' | 'cancelCharge';

/** Gateway falso: registra chamadas, estado programável por cobrança e falhas sob demanda. */
export class FakePaymentGateway implements PaymentGateway {
  readonly charges: CreateChargeArgs[] = [];
  readonly states = new Map<string, ChargeStatus>();
  readonly refunds: { chargeId: string; amountCents: number; reason: string }[] = [];
  readonly cancelled: string[] = [];
  readonly calls: Record<Method, number> = {
    createCharge: 0,
    getPixQrCode: 0,
    getChargeStatus: 0,
    refund: 0,
    cancelCharge: 0,
  };
  /** Métodos que devem falhar na próxima chamada (consumido ao falhar). */
  readonly failNext = new Set<Method>();
  /** Métodos que falham sempre. */
  readonly failAlways = new Set<Method>();

  constructor(
    readonly name: PaymentGatewayName = 'simulated',
    readonly sandbox = true,
  ) {}

  private hit(method: Method) {
    this.calls[method]++;
    if (this.failAlways.has(method) || this.failNext.delete(method)) {
      // Como o adapter real: toda falha chega como GatewayError (asaas-payment R-3).
      throw new GatewayError(`gateway falso: ${method} falhou`);
    }
  }

  chargeIdOf(sponsorshipId: string): string {
    return `${this.name === 'asaas' ? 'pay' : 'sim'}_${sponsorshipId}`;
  }

  async createCharge(args: CreateChargeArgs): Promise<CreatedCharge> {
    this.hit('createCharge');
    this.charges.push(args);
    return {
      chargeId: this.chargeIdOf(args.sponsorshipId),
      customerId: this.name === 'asaas' ? `cus_${args.payer.cpfCnpj}` : null,
      invoiceUrl:
        this.name === 'asaas' ? `https://sandbox.asaas.com/i/${args.sponsorshipId}` : null,
    };
  }

  async getPixQrCode(chargeId: string): Promise<PixQrCode> {
    this.hit('getPixQrCode');
    return { qrCodeImage: 'iVBORw0KGgoFAKE=', payload: `00020126FAKE${chargeId}6304ABCD` };
  }

  async getChargeStatus(chargeId: string): Promise<ChargeStatus> {
    this.hit('getChargeStatus');
    return this.states.get(chargeId) ?? { state: 'pending', method: null };
  }

  async refund(chargeId: string, amountCents: number, reason: string) {
    this.hit('refund');
    if (this.states.get(chargeId)?.state === 'refunded')
      return { state: 'already_refunded' as const };
    this.refunds.push({ chargeId, amountCents, reason });
    return { state: 'done' as const };
  }

  async cancelCharge(chargeId: string): Promise<void> {
    this.hit('cancelCharge');
    this.cancelled.push(chargeId);
  }
}
