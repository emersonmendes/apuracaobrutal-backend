import type { Clock } from '../domain/ports/clock';
import type { PaymentGateway } from '../domain/ports/payment-gateway';
import type { SponsorImageStorage } from '../domain/ports/sponsor-image-storage';
import type { SponsorshipRepository } from '../domain/ports/sponsorship-repository';

/** Imagens de patrocínios encerrados ficam disponíveis por mais 24 h (FR-05). */
export const ENDED_IMAGE_RETENTION_MS = 24 * 60 * 60_000;

interface Logger {
  warn(message: string): void;
}

/**
 * Limpeza do worker (spec sponsorships FR-05): pendentes vencidos → `expired` sem imagem; imagens
 * de patrocínios encerrados há mais de 24 h são apagadas (o registro fica). Com gateway real, a
 * cobrança de cada pedido expirado é cancelada depois da transação, melhor esforço
 * (asaas-payment R-8).
 */
export class ExpirePendingSponsorships {
  constructor(
    private readonly repository: SponsorshipRepository,
    private readonly storage: SponsorImageStorage,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly gateway?: PaymentGateway,
  ) {}

  async execute(): Promise<{ expired: number; imagesRemoved: number; chargesCancelled: number }> {
    const now = this.clock.now();
    let imagesRemoved = 0;
    let chargesCancelled = 0;

    const expired = await this.repository.expirePending(now);
    for (const { id, imageKey } of expired) {
      if (imageKey && (await this.remove(id, imageKey))) imagesRemoved++;
    }
    for (const { id, paymentGateway, chargeId } of expired) {
      if (!this.gateway || paymentGateway !== 'asaas' || this.gateway.name !== 'asaas') continue;
      try {
        await this.gateway.cancelCharge(chargeId);
        chargesCancelled++;
      } catch (error) {
        // Já paga? O webhook chega e a R-5 estorna.
        this.logger.warn(`falha ao cancelar a cobrança do pedido ${id}: ${String(error)}`);
      }
    }

    const ended = await this.repository.endedWithImage(
      new Date(now.getTime() - ENDED_IMAGE_RETENTION_MS),
    );
    for (const { id, imageKey } of ended) {
      if (await this.remove(id, imageKey)) imagesRemoved++;
    }

    return { expired: expired.length, imagesRemoved, chargesCancelled };
  }

  /** Um arquivo que falha não impede os demais. */
  private async remove(id: string, imageKey: string): Promise<boolean> {
    try {
      await this.storage.remove(imageKey);
      await this.repository.clearImage(id);
      return true;
    } catch (error) {
      this.logger.warn(`falha ao remover a imagem do patrocínio ${id}: ${String(error)}`);
      return false;
    }
  }
}
