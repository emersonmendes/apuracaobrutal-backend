import { SponsorshipError } from '../domain/errors';
import type { SponsorImageStorage } from '../domain/ports/sponsor-image-storage';
import type { SponsorshipRepository } from '../domain/ports/sponsorship-repository';

/** Imagem pública: só de pedidos `scheduled` com arquivo presente (FR-03). */
export class ReadSponsorImage {
  constructor(
    private readonly repository: SponsorshipRepository,
    private readonly storage: SponsorImageStorage,
  ) {}

  async execute(id: string): Promise<Buffer> {
    const order = await this.repository.findById(id);
    if (!order || order.status !== 'scheduled' || !order.imageKey) {
      throw new SponsorshipError('not_found');
    }
    const bytes = await this.storage.read(order.imageKey);
    if (!bytes) throw new SponsorshipError('not_found');
    return bytes;
  }
}
