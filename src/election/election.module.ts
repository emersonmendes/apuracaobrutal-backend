import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { GetElectionFeed } from './application/get-election-feed';
import type { ElectionConfig } from './domain/election-config';
import { CLOCK, systemClock, type Clock } from './domain/ports/clock';
import { ELECTION_REPOSITORY, type ElectionRepository } from './domain/ports/election-repository';
import { PrismaElectionRepository } from './infra/adapters/prisma-election-repository';
import { ELECTION_CONFIG, parseElectionConfig } from './infra/config/election-config.factory';
import { ElectionFeedController } from './infra/http/election-feed.controller';
import { FeedPublisher } from './infra/http/feed-publisher';

/** Providers compartilhados pelo backend HTTP e pelo worker (configuração, relógio, repositório). */
export const ELECTION_CORE_PROVIDERS = [
  { provide: ELECTION_CONFIG, useFactory: () => parseElectionConfig(process.env) },
  { provide: CLOCK, useValue: systemClock },
  {
    provide: ELECTION_REPOSITORY,
    useFactory: (prisma: PrismaService) => new PrismaElectionRepository(prisma),
    inject: [PrismaService],
  },
];

/**
 * Lado HTTP do módulo election: feed REST + SSE da home (spec election-results-feed FR-07).
 * O backend só lê o Postgres — quem consulta o TSE é o worker ({@link ElectionWorkerModule}).
 */
@Module({
  imports: [PrismaModule],
  controllers: [ElectionFeedController],
  providers: [
    ...ELECTION_CORE_PROVIDERS,
    {
      provide: GetElectionFeed,
      useFactory: (repository: ElectionRepository, clock: Clock, config: ElectionConfig) =>
        new GetElectionFeed(repository, clock, config),
      inject: [ELECTION_REPOSITORY, CLOCK, ELECTION_CONFIG],
    },
    {
      provide: FeedPublisher,
      useFactory: (getFeed: GetElectionFeed, config: ElectionConfig) =>
        new FeedPublisher(getFeed, config.feedRefreshMs, config.sseMaxClients),
      inject: [GetElectionFeed, ELECTION_CONFIG],
    },
  ],
})
export class ElectionModule {}
