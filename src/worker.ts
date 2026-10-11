import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PollOfficialResults } from './election/application/poll-official-results';
import { ElectionWorkerModule } from './election/election-worker.module';
import { runCleanupLoop } from './sponsorship/application/cleanup-loop';
import { ExpirePendingSponsorships } from './sponsorship/application/expire-pending-sponsorships';
import { SponsorshipWorkerModule } from './sponsorship/sponsorship-worker.module';

/** Contexto do worker: apuração (TSE) + limpeza de patrocínios. */
@Module({ imports: [ElectionWorkerModule, SponsorshipWorkerModule] })
class WorkerModule {}

/**
 * Entrypoint do runtime `worker` (spec election-results-feed FR-03): sem HTTP, consulta o TSE em
 * ciclos até receber SIGTERM/SIGINT; o ciclo em andamento termina antes de fechar. Em paralelo,
 * roda a limpeza dos patrocínios (spec sponsorships FR-05).
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  const logger = new Logger('Worker');
  const controller = new AbortController();

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      logger.log(`${signal} recebido — encerrando após o ciclo atual`);
      controller.abort();
    });
  }

  logger.log('worker iniciado');
  await Promise.all([
    app.get(PollOfficialResults).run(controller.signal),
    runCleanupLoop(
      app.get(ExpirePendingSponsorships),
      controller.signal,
      new Logger('SponsorshipCleanup'),
    ),
  ]);
  await app.close();
  logger.log('worker encerrado');
}

bootstrap();
