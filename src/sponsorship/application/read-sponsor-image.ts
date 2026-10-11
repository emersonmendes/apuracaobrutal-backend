import { SponsorshipError } from '../domain/errors';
import { sha256Hex } from '../domain/image-rules';
import { publishable } from '../domain/moderation-state';
import type { SponsorImageStorage } from '../domain/ports/sponsor-image-storage';
import type { SponsorshipRepository } from '../domain/ports/sponsorship-repository';

interface Logger {
  warn(message: string): void;
}

/**
 * Imagem pública: só de pedidos `scheduled`, aprovados na moderação e com arquivo presente cujo
 * hash bate com o analisado (FR-03; sponsorship-image-moderation R-6, R-7).
 */
export class ReadSponsorImage {
  constructor(
    private readonly repository: SponsorshipRepository,
    private readonly storage: SponsorImageStorage,
    private readonly logger: Logger = { warn: () => undefined },
  ) {}

  async execute(id: string): Promise<Buffer> {
    const order = await this.repository.findById(id);
    if (!order || !publishable(order)) throw new SponsorshipError('not_found');
    const bytes = await this.storage.read(order.imageKey!);
    if (!bytes) throw new SponsorshipError('not_found');
    if (sha256Hex(bytes) !== order.imageSha256) {
      this.logger.warn(`imagem do pedido ${id} difere da analisada; publicação bloqueada`);
      throw new SponsorshipError('not_found');
    }
    return bytes;
  }
}
