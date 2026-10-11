import { effectiveStatus, type Sponsorship } from '../domain/scheduling';
import type { Clock } from '../domain/ports/clock';
import type { PaymentGateway } from '../domain/ports/payment-gateway';
import type { SponsorshipRepository } from '../domain/ports/sponsorship-repository';
import type { ConfirmPayment } from './confirm-payment';

/** Intervalo mínimo entre consultas ao gateway para o mesmo pedido, por instância (R-5 b). */
export const RECONCILE_MIN_INTERVAL_MS = 5_000;
const PRUNE_AFTER_MS = 60_000;
const PRUNE_ABOVE = 1_000;

interface Logger {
  warn(message: string): void;
}

/**
 * Consulta sob demanda (spec asaas-payment R-5 b): enquanto a página aguarda, o backend confere no
 * gateway se a cobrança de um pedido pendente já foi paga e, se sim, confirma pelo mesmo caminho do
 * webhook. Falha na consulta é silenciosa; o pedido continua pendente.
 */
export class ReconcilePendingPayment {
  private readonly lastCheck = new Map<string, number>();

  constructor(
    private readonly repository: SponsorshipRepository,
    private readonly gateway: PaymentGateway,
    private readonly confirm: ConfirmPayment,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  /** Devolve o pedido como ficou (pode ter sido agendado ou expirado com estorno). */
  async execute(order: Sponsorship): Promise<Sponsorship> {
    const now = this.clock.now();
    if (
      order.paymentGateway !== 'asaas' ||
      this.gateway.name !== 'asaas' ||
      // Pela UI ninguém paga antes da aprovação: não gasta consulta (sponsorship-image-moderation R-7).
      order.moderation !== 'approved' ||
      effectiveStatus(order, now) !== 'pending_payment' ||
      !this.due(order.id, now.getTime())
    ) {
      return order;
    }

    try {
      const status = await this.gateway.getChargeStatus(order.chargeId);
      if (status.state !== 'paid') return order;
      await this.confirm.confirmReceived(order.id, {
        chargeId: order.chargeId,
        amountCents: order.amountCents,
        method: status.method ?? 'other',
      });
    } catch (error) {
      this.logger.warn(`consulta ao gateway falhou para o pedido ${order.id}: ${String(error)}`);
      return order;
    }
    return (await this.repository.findById(order.id)) ?? order;
  }

  /** No máximo uma consulta a cada 5 s por pedido; o mapa é podado para não crescer sem limite. */
  private due(id: string, nowMs: number): boolean {
    const last = this.lastCheck.get(id);
    if (last !== undefined && nowMs - last < RECONCILE_MIN_INTERVAL_MS) return false;
    this.lastCheck.set(id, nowMs);
    if (this.lastCheck.size > PRUNE_ABOVE) {
      for (const [key, at] of this.lastCheck) {
        if (nowMs - at > PRUNE_AFTER_MS) this.lastCheck.delete(key);
      }
    }
    return true;
  }
}
