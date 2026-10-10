import { Logger, Module } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaModule } from '../prisma/prisma.module';
import { PollOfficialResults } from './application/poll-official-results';
import type { ElectionConfig } from './domain/election-config';
import { CLOCK, type Clock } from './domain/ports/clock';
import { ELECTION_REPOSITORY, type ElectionRepository } from './domain/ports/election-repository';
import { RESULTS_SOURCE, type ResultsSource } from './domain/ports/results-source';
import { TseResultsSource } from './infra/adapters/tse-results-source';
import { ELECTION_CONFIG } from './infra/config/election-config.factory';
import { ELECTION_CORE_PROVIDERS } from './election.module';
// Versão para o User-Agent (R-11); package.json fica na raiz tanto em src/ quanto em dist/.
const { version } = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')) as {
  version: string;
};

/** Runtime worker: consulta o TSE e grava no Postgres (spec election-results-feed FR-03). */
@Module({
  imports: [PrismaModule],
  providers: [
    ...ELECTION_CORE_PROVIDERS,
    {
      provide: RESULTS_SOURCE,
      useFactory: (config: ElectionConfig) =>
        new TseResultsSource(config, `apuracaobrutal-worker/${version}`),
      inject: [ELECTION_CONFIG],
    },
    {
      provide: PollOfficialResults,
      useFactory: (
        source: ResultsSource,
        repository: ElectionRepository,
        clock: Clock,
        config: ElectionConfig,
      ) => new PollOfficialResults(source, repository, clock, config, new Logger('ElectionWorker')),
      inject: [RESULTS_SOURCE, ELECTION_REPOSITORY, CLOCK, ELECTION_CONFIG],
    },
  ],
})
export class ElectionWorkerModule {}
