import { randomUUID } from 'node:crypto';
import { SponsorshipError } from '../domain/errors';
import { OUTPUT_MAX_SIDE_PX, detectImageFormat, dimensionsAllowed } from '../domain/image-rules';
import { quote } from '../domain/pricing';
import { newPendingOrder } from '../domain/scheduling';
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
    await this.storage.save(imageKey, webp);
    try {
      const price = quote(input.slot, input.minutes, this.config);
      const { chargeId } = await this.gateway.createCharge({
        sponsorshipId: id,
        amountCents: price.amountCents,
        description: `Patrocínio ${input.slot} — ${input.minutes} min`,
      });
      const order = newPendingOrder({
        id,
        input,
        quote: price,
        imageKey,
        gateway: this.gateway.name,
        chargeId,
        now: this.clock.now(),
        paymentTtlMinutes: this.config.paymentTtlMinutes,
      });
      await this.repository.create(order);
      return toPublic(order, order.createdAt);
    } catch (error) {
      // Melhor esforço: a limpeza do worker cobre o que sobrar (FR-04).
      await this.storage.remove(imageKey).catch(() => undefined);
      throw error;
    }
  }
}
