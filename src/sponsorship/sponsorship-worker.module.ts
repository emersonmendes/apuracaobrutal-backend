import { Logger, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ExpirePendingSponsorships } from './application/expire-pending-sponsorships';
import { SPONSORSHIP_CLOCK, type Clock } from './domain/ports/clock';
import {
  SPONSOR_IMAGE_STORAGE,
  type SponsorImageStorage,
} from './domain/ports/sponsor-image-storage';
import {
  SPONSORSHIP_REPOSITORY,
  type SponsorshipRepository,
} from './domain/ports/sponsorship-repository';
import { SPONSORSHIP_CORE_PROVIDERS } from './sponsorship.module';

/** Runtime worker: limpeza periódica dos patrocínios (spec sponsorships FR-05). */
@Module({
  imports: [PrismaModule],
  providers: [
    ...SPONSORSHIP_CORE_PROVIDERS,
    {
      provide: ExpirePendingSponsorships,
      useFactory: (r: SponsorshipRepository, s: SponsorImageStorage, c: Clock) =>
        new ExpirePendingSponsorships(r, s, c, new Logger('SponsorshipCleanup')),
      inject: [SPONSORSHIP_REPOSITORY, SPONSOR_IMAGE_STORAGE, SPONSORSHIP_CLOCK],
    },
  ],
  exports: [ExpirePendingSponsorships],
})
export class SponsorshipWorkerModule {}
