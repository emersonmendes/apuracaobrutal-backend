import { Logger, Module } from '@nestjs/common';
import { parseElectionConfig } from '../election/infra/config/election-config.factory';
import { ModerateImage } from '../moderation/application/moderate-image';
import {
  MODERATION_CONFIG,
  type ModerationConfig,
} from '../moderation/infra/config/moderation-config.factory';
import { ModerationModule } from '../moderation/moderation.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { ExpirePendingSponsorships } from './application/expire-pending-sponsorships';
import { ModeratePendingSponsorships } from './application/moderate-pending-sponsorships';
import { ProcessPaymentRefunds } from './application/process-payment-refunds';
import { CANDIDATE_IDENTITY, type CandidateIdentity } from './domain/ports/candidate-identity';
import { PAYMENT_GATEWAY, type PaymentGateway } from './domain/ports/payment-gateway';
import { SPONSORSHIP_CLOCK, type Clock } from './domain/ports/clock';
import {
  SPONSOR_IMAGE_STORAGE,
  type SponsorImageStorage,
} from './domain/ports/sponsor-image-storage';
import {
  SPONSORSHIP_REPOSITORY,
  type SponsorshipRepository,
} from './domain/ports/sponsorship-repository';
import type { SponsorshipConfig } from './domain/sponsorship-config';
import { PrismaCandidateIdentity } from './infra/adapters/prisma-candidate-identity';
import { SPONSORSHIP_CONFIG } from './infra/config/sponsorship-config.factory';
import { SPONSORSHIP_CORE_PROVIDERS } from './sponsorship.module';

/**
 * Runtime worker: limpeza periódica, estornos e moderação das imagens dos patrocínios
 * (sponsorships FR-05; asaas-payment FR-05; sponsorship-image-moderation FR-05).
 */
@Module({
  imports: [PrismaModule, ModerationModule],
  providers: [
    ...SPONSORSHIP_CORE_PROVIDERS,
    {
      provide: ExpirePendingSponsorships,
      useFactory: (r: SponsorshipRepository, s: SponsorImageStorage, c: Clock, g: PaymentGateway) =>
        new ExpirePendingSponsorships(r, s, c, new Logger('SponsorshipCleanup'), g),
      inject: [SPONSORSHIP_REPOSITORY, SPONSOR_IMAGE_STORAGE, SPONSORSHIP_CLOCK, PAYMENT_GATEWAY],
    },
    {
      provide: ProcessPaymentRefunds,
      useFactory: (r: SponsorshipRepository, g: PaymentGateway, c: Clock) =>
        new ProcessPaymentRefunds(r, g, c, new Logger('PaymentRefunds')),
      inject: [SPONSORSHIP_REPOSITORY, PAYMENT_GATEWAY, SPONSORSHIP_CLOCK],
    },
    // Nome e número de urna dos dois lados para D-5/D-6 (sponsorship-image-moderation R-4).
    {
      provide: CANDIDATE_IDENTITY,
      useFactory: (prisma: PrismaService): CandidateIdentity => {
        const election = parseElectionConfig(process.env);
        return new PrismaCandidateIdentity(prisma, election.electionCode, election.sides);
      },
      inject: [PrismaService],
    },
    {
      provide: ModeratePendingSponsorships,
      useFactory: (
        r: SponsorshipRepository,
        s: SponsorImageStorage,
        moderate: ModerateImage,
        identity: CandidateIdentity,
        g: PaymentGateway,
        c: Clock,
        cfg: SponsorshipConfig,
        moderation: ModerationConfig,
      ) =>
        new ModeratePendingSponsorships(
          r,
          s,
          moderate,
          identity,
          g,
          c,
          cfg,
          {
            timeoutMs: moderation.timeoutMs,
            labelMinConfidence: moderation.labelMinConfidence,
            celebrityMinConfidence: moderation.celebrityMinConfidence,
          },
          new Logger('ImageModeration'),
        ),
      inject: [
        SPONSORSHIP_REPOSITORY,
        SPONSOR_IMAGE_STORAGE,
        ModerateImage,
        CANDIDATE_IDENTITY,
        PAYMENT_GATEWAY,
        SPONSORSHIP_CLOCK,
        SPONSORSHIP_CONFIG,
        MODERATION_CONFIG,
      ],
    },
  ],
  exports: [ExpirePendingSponsorships, ProcessPaymentRefunds, ModeratePendingSponsorships],
})
export class SponsorshipWorkerModule {}
