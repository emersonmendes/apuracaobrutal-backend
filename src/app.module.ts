import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';

/**
 * Módulo raiz. No bootstrap só existe o `HealthModule` (spec: backend-bootstrap R-3); o
 * `PrismaModule` é importado apenas por módulos que tiverem adapters Prisma.
 */
@Module({
  imports: [HealthModule],
})
export class AppModule {}
