import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PollOfficialResults } from './election/application/poll-official-results';
import { ElectionWorkerModule } from './election/election-worker.module';

/**
 * Entrypoint do runtime `worker` (spec election-results-feed FR-03): sem HTTP, consulta o TSE em
 * ciclos até receber SIGTERM/SIGINT; o ciclo em andamento termina antes de fechar.
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(ElectionWorkerModule);
  const logger = new Logger('Worker');
  const controller = new AbortController();

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      logger.log(`${signal} recebido — encerrando após o ciclo atual`);
      controller.abort();
    });
  }

  logger.log('worker iniciado');
  await app.get(PollOfficialResults).run(controller.signal);
  await app.close();
  logger.log('worker encerrado');
}

bootstrap();
