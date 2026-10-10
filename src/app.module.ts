import { Module } from '@nestjs/common';
import { ElectionModule } from './election/election.module';
import { HealthModule } from './health/health.module';

/**
 * Módulo raiz: health check (backend-bootstrap) e feed da apuração (election-results-feed). O
 * `PrismaModule` é importado apenas por módulos que tiverem adapters Prisma.
 */
@Module({
  imports: [HealthModule, ElectionModule],
})
export class AppModule {}
