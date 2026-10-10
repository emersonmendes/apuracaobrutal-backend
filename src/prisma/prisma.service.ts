import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Fronteira de persistência compartilhada: o único wrapper do `PrismaClient`.
 *
 * Módulos de negócio injetam este serviço nos seus adapters de repositório (nunca no `domain/`).
 * Spec: /specs/backend-bootstrap (FR-02, FR-06).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
