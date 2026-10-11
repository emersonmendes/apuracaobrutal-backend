import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { ConfirmPayment } from './application/confirm-payment';
import { CreateSponsorship } from './application/create-sponsorship';
import { GetOffer } from './application/get-offer';
import { GetSchedule } from './application/get-schedule';
import { GetSponsorship } from './application/get-sponsorship';
import { ReadSponsorImage } from './application/read-sponsor-image';
import type { SponsorshipConfig } from './domain/sponsorship-config';
import { SPONSORSHIP_CLOCK, systemClock, type Clock } from './domain/ports/clock';
import { IMAGE_PROCESSOR, type ImageProcessor } from './domain/ports/image-processor';
import { PAYMENT_GATEWAY, type PaymentGateway } from './domain/ports/payment-gateway';
import {
  SPONSOR_IMAGE_STORAGE,
  type SponsorImageStorage,
} from './domain/ports/sponsor-image-storage';
import {
  SPONSORSHIP_REPOSITORY,
  type SponsorshipRepository,
} from './domain/ports/sponsorship-repository';
import { LocalDiskImageStorage } from './infra/adapters/local-disk-image-storage';
import { PrismaSponsorshipRepository } from './infra/adapters/prisma-sponsorship-repository';
import { SharpImageProcessor } from './infra/adapters/sharp-image-processor';
import { SimulatedPaymentGateway } from './infra/adapters/simulated-payment-gateway';
import {
  SPONSORSHIP_CONFIG,
  parseSponsorshipConfig,
} from './infra/config/sponsorship-config.factory';
import { SponsorshipsController } from './infra/http/sponsorships.controller';

const HOUR_MS = 60 * 60_000;

/** Providers compartilhados pelo backend HTTP e pelo worker. */
export const SPONSORSHIP_CORE_PROVIDERS = [
  { provide: SPONSORSHIP_CONFIG, useFactory: () => parseSponsorshipConfig(process.env) },
  { provide: SPONSORSHIP_CLOCK, useValue: systemClock },
  {
    provide: SPONSORSHIP_REPOSITORY,
    useFactory: (prisma: PrismaService) => new PrismaSponsorshipRepository(prisma),
    inject: [PrismaService],
  },
  {
    provide: SPONSOR_IMAGE_STORAGE,
    useFactory: (config: SponsorshipConfig) => new LocalDiskImageStorage(config.storageDir),
    inject: [SPONSORSHIP_CONFIG],
  },
];

/** Lado HTTP dos patrocínios (spec sponsorships FR-03, FR-04). */
@Module({
  imports: [
    PrismaModule,
    // Limites do upload aplicados no parser, antes de ler tudo (FR-03, NFR de segurança).
    MulterModule.registerAsync({
      useFactory: () => {
        const config = parseSponsorshipConfig(process.env);
        // Sem `dest`/`storage`: o arquivo fica em memória (Buffer) e nunca toca o disco cru.
        return {
          limits: { fileSize: config.imageMaxBytes, files: 1, fields: 10, fieldSize: 1024 },
        };
      },
    }),
    // Pedidos criados por IP por hora (AC-12); o guard só é aplicado no POST /sponsorships.
    ThrottlerModule.forRootAsync({
      useFactory: () => ({
        throttlers: [
          { ttl: HOUR_MS, limit: parseSponsorshipConfig(process.env).createLimitPerHour },
        ],
      }),
    }),
  ],
  controllers: [SponsorshipsController],
  providers: [
    ...SPONSORSHIP_CORE_PROVIDERS,
    { provide: PAYMENT_GATEWAY, useFactory: () => new SimulatedPaymentGateway() },
    { provide: IMAGE_PROCESSOR, useFactory: () => new SharpImageProcessor() },
    {
      provide: GetOffer,
      useFactory: (r: SponsorshipRepository, c: Clock, cfg: SponsorshipConfig) =>
        new GetOffer(r, c, cfg),
      inject: [SPONSORSHIP_REPOSITORY, SPONSORSHIP_CLOCK, SPONSORSHIP_CONFIG],
    },
    {
      provide: CreateSponsorship,
      useFactory: (
        r: SponsorshipRepository,
        s: SponsorImageStorage,
        i: ImageProcessor,
        g: PaymentGateway,
        c: Clock,
        cfg: SponsorshipConfig,
      ) => new CreateSponsorship(r, s, i, g, c, cfg),
      inject: [
        SPONSORSHIP_REPOSITORY,
        SPONSOR_IMAGE_STORAGE,
        IMAGE_PROCESSOR,
        PAYMENT_GATEWAY,
        SPONSORSHIP_CLOCK,
        SPONSORSHIP_CONFIG,
      ],
    },
    {
      provide: ConfirmPayment,
      useFactory: (r: SponsorshipRepository, c: Clock, cfg: SponsorshipConfig) =>
        new ConfirmPayment(r, c, cfg),
      inject: [SPONSORSHIP_REPOSITORY, SPONSORSHIP_CLOCK, SPONSORSHIP_CONFIG],
    },
    {
      provide: GetSponsorship,
      useFactory: (r: SponsorshipRepository, c: Clock) => new GetSponsorship(r, c),
      inject: [SPONSORSHIP_REPOSITORY, SPONSORSHIP_CLOCK],
    },
    {
      provide: GetSchedule,
      useFactory: (r: SponsorshipRepository, c: Clock) => new GetSchedule(r, c),
      inject: [SPONSORSHIP_REPOSITORY, SPONSORSHIP_CLOCK],
    },
    {
      provide: ReadSponsorImage,
      useFactory: (r: SponsorshipRepository, s: SponsorImageStorage) => new ReadSponsorImage(r, s),
      inject: [SPONSORSHIP_REPOSITORY, SPONSOR_IMAGE_STORAGE],
    },
  ],
})
export class SponsorshipModule {}
