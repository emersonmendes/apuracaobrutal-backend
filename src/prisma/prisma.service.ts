import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Fronteira de persistência compartilhada: o único wrapper do `PrismaClient`.
 *
 * Módulos de negócio injetam este serviço nos seus adapters de repositório (nunca no `domain/`).
 * Spec: /specs/backend-bootstrap (FR-02, FR-06).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  // Sem `$connect()` no init: o Prisma conecta na primeira consulta, então o processo sobe e o
  // `/ping` responde mesmo com o Postgres fora do ar (backend-bootstrap, casos de borda).

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
