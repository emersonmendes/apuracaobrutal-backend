import { Module } from '@nestjs/common';
import { ElectionModule } from './election/election.module';
import { HealthModule } from './health/health.module';
import { SponsorshipModule } from './sponsorship/sponsorship.module';

/**
 * Módulo raiz: health check (backend-bootstrap), feed da apuração (election-results-feed) e
 * patrocínios (sponsorships). O `PrismaModule` é importado apenas por módulos que tiverem
 * adapters Prisma.
 */
@Module({
  imports: [HealthModule, ElectionModule, SponsorshipModule],
})
export class AppModule {}
