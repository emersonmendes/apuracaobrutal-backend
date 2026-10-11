import { SponsorshipError } from '../domain/errors';
import type { ReceivedPayment } from '../domain/payment';
import { purchaseAvailable, type SponsorshipConfig } from '../domain/sponsorship-config';
import type { Clock } from '../domain/ports/clock';
import type { ConfirmOutcome, SponsorshipRepository } from '../domain/ports/sponsorship-repository';
import { toPublic, type PublicSponsorship } from './public-sponsorship';

/**
 * Confirma o pagamento e agenda (spec sponsorships FR-04, R-9, Fluxo 3). Idempotente. Três
 * origens chamam o mesmo caso de uso (asaas-payment R-5): a ação simulada (`execute`) e, com
 * pagamento real, o webhook e a consulta sob demanda (`confirmReceived`).
 */
export class ConfirmPayment {
  constructor(
    private readonly repository: SponsorshipRepository,
    private readonly clock: Clock,
    private readonly config: SponsorshipConfig,
  ) {}

  /** Ação `Pagar (simulado)`: só existe com gateway simulado (asaas-payment FR-03). */
  async execute(id: string): Promise<PublicSponsorship> {
    if (!purchaseAvailable(this.config)) throw new SponsorshipError('unavailable');
    if (this.config.gateway !== 'simulated') throw new SponsorshipError('not_found');
    const now = this.clock.now();
    const outcome = await this.repository.confirm(id, now, this.config.electionDay);
    if (outcome.kind === 'not_found') throw new SponsorshipError('not_found');
    // Só pedido aprovado na moderação pode ser pago (sponsorship-image-moderation R-7).
    if (outcome.kind === 'not_approved')
      throw new SponsorshipError(`moderation_${outcome.moderation}`);
    if (outcome.kind === 'expired') throw new SponsorshipError('expired');
    if (outcome.kind === 'price_changed') throw new SponsorshipError('price_changed');
    return toPublic(outcome.sponsorship, now, this.config);
  }

  /**
   * Pagamento real recebido (webhook ou consulta): o repositório grava o desfecho da R-5 — agenda,
   * ou expira com pedido de estorno. Não lança para desfechos de negócio: quem chama decide.
   */
  confirmReceived(
    id: string,
    received: ReceivedPayment,
    repository: SponsorshipRepository = this.repository,
  ): Promise<ConfirmOutcome> {
    return repository.confirm(id, this.clock.now(), this.config.electionDay, received);
  }
}
