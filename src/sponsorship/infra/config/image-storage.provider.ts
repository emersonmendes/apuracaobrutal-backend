import type { SponsorImageStorage } from '../../domain/ports/sponsor-image-storage';
import type { SponsorshipConfig } from '../../domain/sponsorship-config';
import { LocalDiskImageStorage } from '../adapters/local-disk-image-storage';
import { S3ImageStorage } from '../adapters/s3-image-storage';

interface Logger {
  log(message: string): void;
  warn(message: string): void;
}

/**
 * Adapter da porta `SponsorImageStorage` conforme `SPONSORSHIP_STORAGE` (spec
 * sponsorship-s3-storage FR-03, R-1). Compartilhada pelo backend HTTP e pelo worker; nenhuma
 * chamada à AWS acontece aqui. O log nunca contém credenciais.
 */
export function createImageStorage(config: SponsorshipConfig, logger: Logger): SponsorImageStorage {
  const { storage } = config;
  if (storage.kind === 's3') {
    logger.log(`armazenamento de imagens: s3 bucket=${storage.bucket} region=${storage.region}`);
    return new S3ImageStorage({ ...storage, maxBytes: config.imageMaxBytes }, undefined, logger);
  }
  logger.log(`armazenamento de imagens: local dir=${storage.dir}`);
  return new LocalDiskImageStorage(storage.dir);
}
