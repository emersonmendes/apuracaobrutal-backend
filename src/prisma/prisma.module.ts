import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Expõe o {@link PrismaService} aos módulos que tiverem adapters de persistência.
 * Spec: /specs/backend-bootstrap (FR-02).
 */
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
