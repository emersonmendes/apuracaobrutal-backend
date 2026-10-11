import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { Logger } from '@nestjs/common';
import { ConfirmPayment } from './application/confirm-payment';
import { CreateSponsorship } from './application/create-sponsorship';
import { GetOffer } from './application/get-offer';
import { GetPaymentInstructions } from './application/get-payment-instructions';
import { HandleAsaasWebhook } from './application/handle-asaas-webhook';
import { ReconcilePendingPayment } from './application/reconcile-pending-payment';
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
import { AsaasPaymentGateway } from './infra/adapters/asaas-payment-gateway';
import { PrismaSponsorshipRepository } from './infra/adapters/prisma-sponsorship-repository';
import { SharpImageProcessor } from './infra/adapters/sharp-image-processor';
import { SimulatedPaymentGateway } from './infra/adapters/simulated-payment-gateway';
import { createImageStorage } from './infra/config/image-storage.provider';
import {
  SPONSORSHIP_CONFIG,
  parseSponsorshipConfig,
} from './infra/config/sponsorship-config.factory';
import { AsaasWebhookController } from './infra/http/asaas-webhook.controller';
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
  // Adapter de armazenamento conforme SPONSORSHIP_STORAGE (sponsorship-s3-storage FR-03).
  {
    provide: SPONSOR_IMAGE_STORAGE,
    useFactory: (config: SponsorshipConfig) =>
      createImageStorage(config, new Logger('SponsorImageStorage')),
    inject: [SPONSORSHIP_CONFIG],
  },
  // Adapter da porta de cobrança conforme PAYMENT_GATEWAY (sponsorships R-9; asaas-payment R-1).
  {
    provide: PAYMENT_GATEWAY,
    useFactory: (config: SponsorshipConfig): PaymentGateway =>
      config.gateway === 'asaas' && config.asaas
        ? new AsaasPaymentGateway(config.asaas)
        : new SimulatedPaymentGateway(),
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
  controllers: [SponsorshipsController, AsaasWebhookController],
  providers: [
    ...SPONSORSHIP_CORE_PROVIDERS,
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
      provide: ReconcilePendingPayment,
      useFactory: (
        r: SponsorshipRepository,
        g: PaymentGateway,
        confirm: ConfirmPayment,
        c: Clock,
      ) => new ReconcilePendingPayment(r, g, confirm, c, new Logger('PaymentReconcile')),
      inject: [SPONSORSHIP_REPOSITORY, PAYMENT_GATEWAY, ConfirmPayment, SPONSORSHIP_CLOCK],
    },
    {
      provide: GetSponsorship,
      useFactory: (
        r: SponsorshipRepository,
        c: Clock,
        cfg: SponsorshipConfig,
        reconcile: ReconcilePendingPayment,
      ) => new GetSponsorship(r, c, cfg, reconcile),
      inject: [
        SPONSORSHIP_REPOSITORY,
        SPONSORSHIP_CLOCK,
        SPONSORSHIP_CONFIG,
        ReconcilePendingPayment,
      ],
    },
    {
      provide: GetPaymentInstructions,
      useFactory: (r: SponsorshipRepository, g: PaymentGateway, c: Clock, cfg: SponsorshipConfig) =>
        new GetPaymentInstructions(r, g, c, cfg),
      inject: [SPONSORSHIP_REPOSITORY, PAYMENT_GATEWAY, SPONSORSHIP_CLOCK, SPONSORSHIP_CONFIG],
    },
    {
      provide: HandleAsaasWebhook,
      useFactory: (r: SponsorshipRepository, confirm: ConfirmPayment, c: Clock) =>
        new HandleAsaasWebhook(r, confirm, c),
      inject: [SPONSORSHIP_REPOSITORY, ConfirmPayment, SPONSORSHIP_CLOCK],
    },
    {
      provide: GetSchedule,
      useFactory: (r: SponsorshipRepository, c: Clock) => new GetSchedule(r, c),
      inject: [SPONSORSHIP_REPOSITORY, SPONSORSHIP_CLOCK],
    },
    {
      provide: ReadSponsorImage,
      useFactory: (r: SponsorshipRepository, s: SponsorImageStorage) =>
        new ReadSponsorImage(r, s, new Logger('SponsorImage')),
      inject: [SPONSORSHIP_REPOSITORY, SPONSOR_IMAGE_STORAGE],
    },
  ],
})
export class SponsorshipModule {}
