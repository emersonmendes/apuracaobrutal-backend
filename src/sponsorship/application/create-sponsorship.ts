import { randomUUID } from 'node:crypto';
import { SponsorshipError } from '../domain/errors';
import {
  OUTPUT_MAX_SIDE_PX,
  detectImageFormat,
  dimensionsAllowed,
  sha256Hex,
} from '../domain/image-rules';
import { localDateOf } from '../domain/local-date';
import { priceTierOf, quote } from '../domain/pricing';
import { newPendingOrder, schedule } from '../domain/scheduling';
import { purchaseAvailable, type SponsorshipConfig } from '../domain/sponsorship-config';
import { validateOrderInput, type RawOrderInput } from '../domain/validation';
import type { Clock } from '../domain/ports/clock';
import type { ImageProcessor } from '../domain/ports/image-processor';
import type { PaymentGateway } from '../domain/ports/payment-gateway';
import type { SponsorImageStorage } from '../domain/ports/sponsor-image-storage';
import type { SponsorshipRepository } from '../domain/ports/sponsorship-repository';
import { toPublic, type PublicSponsorship } from './public-sponsorship';

/** Cria o pedido `pending_payment` (spec sponsorships FR-04, Fluxo 2). */
export class CreateSponsorship {
  constructor(
    private readonly repository: SponsorshipRepository,
    private readonly storage: SponsorImageStorage,
    private readonly images: ImageProcessor,
    private readonly gateway: PaymentGateway,
    private readonly clock: Clock,
    private readonly config: SponsorshipConfig,
    private readonly newId: () => string = randomUUID,
  ) {}

  async execute(raw: RawOrderInput, image: Buffer | undefined): Promise<PublicSponsorship> {
    if (!purchaseAvailable(this.config)) throw new SponsorshipError('unavailable');

    const validation = validateOrderInput(raw, this.config.maxMinutes);
    if (!validation.ok) throw new SponsorshipError(validation.code);
    const input = validation.value;

    if (!image || detectImageFormat(image) === null) throw new SponsorshipError('invalid_image');
    if (image.length > this.config.imageMaxBytes) throw new SponsorshipError('image_too_large');
    const size = await this.images.inspect(image);
    if (!size || !dimensionsAllowed(size.width, size.height)) {
      throw new SponsorshipError('invalid_image');
    }
    let webp: Buffer;
    try {
      webp = await this.images.toWebp(image, OUTPUT_MAX_SIDE_PX);
    } catch {
      throw new SponsorshipError('invalid_image');
    }

    const id = this.newId();
    const imageKey = `${id}.webp`;
    // Identidade da imagem analisada e publicada (sponsorship-image-moderation R-6).
    const imageSha256 = sha256Hex(webp);
    await this.storage.save(imageKey, webp);
    try {
      // Preço só do backend: janela prevista pela fila atual do local → faixa → cotação
      // (sponsorship-election-pricing R-4). Nenhum campo de preço vem do cliente.
      const now = this.clock.now();
      const queueEnd = (await this.repository.queueEnds())[input.slot] ?? null;
      const predicted = schedule(now, input.minutes, queueEnd);
      const tier = priceTierOf(predicted, this.config.electionDay);
      const price = quote(input.slot, input.minutes, tier, this.config);
      // Cobrança no gateway antes de gravar (asaas-payment R-3): vence na data civil do prazo de
      // pagamento; o pagador vai só para o gateway, nunca para respostas.
      const paymentExpiresAt = new Date(now.getTime() + this.config.paymentTtlMinutes * 60_000);
      const charge = await this.gateway.createCharge({
        sponsorshipId: id,
        amountCents: price.amountCents,
        description: `Patrocínio ${input.slot} — ${input.minutes} min`,
        dueDate: localDateOf(paymentExpiresAt),
        payer: { name: input.advertiserName, email: input.email, cpfCnpj: input.cpfCnpj },
      });
      const order = newPendingOrder({
        id,
        input,
        quote: price,
        imageKey,
        imageSha256,
        gateway: this.gateway.name,
        chargeId: charge.chargeId,
        gatewayCustomerId: charge.customerId,
        invoiceUrl: charge.invoiceUrl,
        now,
        paymentTtlMinutes: this.config.paymentTtlMinutes,
      });
      await this.repository.create(order);
      return toPublic(order, order.createdAt, this.config);
    } catch (error) {
      // Melhor esforço: a limpeza do worker cobre o que sobrar (FR-04).
      await this.storage.remove(imageKey).catch(() => undefined);
      throw error;
    }
  }
}
