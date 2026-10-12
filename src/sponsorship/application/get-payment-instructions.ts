import { SponsorshipError } from '../domain/errors';
import { canReceivePayment } from '../domain/moderation-state';
import { effectiveStatus, expiredByDeadline } from '../domain/scheduling';
import { sandboxPayments, type SponsorshipConfig } from '../domain/sponsorship-config';
import type { Clock } from '../domain/ports/clock';
import type { PaymentGateway, PixQrCode } from '../domain/ports/payment-gateway';
import type { SponsorshipRepository } from '../domain/ports/sponsorship-repository';

export type PaymentInstructions =
  | { gateway: 'simulated'; sandbox: true }
  | {
      gateway: 'asaas';
      sandbox: boolean;
      /** Validade do pedido (R-4) — nunca a do QR do Asaas. */
      expiresAt: Date;
      pix: { qrCodeImage: string; payload: string };
      card: { invoiceUrl: string | null };
    };

const CACHE_PRUNE_ABOVE = 1_000;

/** Instruções de pagamento de um pedido pendente (spec asaas-payment R-4, FR-03). */
export class GetPaymentInstructions {
  /** QR por cobrança até o prazo do pedido: o QR não muda e repetir não gasta cota (NFR). */
  private readonly cache = new Map<string, { pix: PixQrCode; expiresAt: number }>();

  constructor(
    private readonly repository: SponsorshipRepository,
    private readonly gateway: PaymentGateway,
    private readonly clock: Clock,
    private readonly config: SponsorshipConfig,
  ) {}

  async execute(id: string): Promise<PaymentInstructions> {
    const order = await this.repository.findById(id);
    if (!order) throw new SponsorshipError('not_found');
    const now = this.clock.now();
    // Prazo vencido vem antes do gate de moderação (sponsorship-image-moderation R-7).
    if (expiredByDeadline(order, now)) throw new SponsorshipError('expired');
    // Nada de QR, copia-e-cola ou fatura antes da aprovação (R-7).
    const gate = canReceivePayment(order);
    if (gate !== 'ok') throw new SponsorshipError(gate);
    if (effectiveStatus(order, now) === 'scheduled') throw new SponsorshipError('already_paid');
    if (order.paymentGateway !== 'asaas' || this.gateway.name !== 'asaas') {
      return { gateway: 'simulated', sandbox: true };
    }
    const pix = await this.pixFor(order.chargeId, order.paymentExpiresAt);
    return {
      gateway: 'asaas',
      sandbox: sandboxPayments(this.config),
      expiresAt: order.paymentExpiresAt,
      pix,
      card: { invoiceUrl: order.invoiceUrl },
    };
  }

  private async pixFor(chargeId: string, expiresAt: Date): Promise<PixQrCode> {
    const nowMs = this.clock.now().getTime();
    const cached = this.cache.get(chargeId);
    if (cached && nowMs < cached.expiresAt) return cached.pix;
    const pix = await this.gateway.getPixQrCode(chargeId);
    this.cache.set(chargeId, { pix, expiresAt: expiresAt.getTime() });
    if (this.cache.size > CACHE_PRUNE_ABOVE) {
      for (const [key, entry] of this.cache) if (nowMs >= entry.expiresAt) this.cache.delete(key);
    }
    return pix;
  }
}
