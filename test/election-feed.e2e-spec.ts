import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { get, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/config/configure-app';
import { createSwaggerDocument } from '../src/config/swagger';
import { InMemoryElectionRepository } from '../src/election/application/__fakes__/in-memory-election-repository';
import { makeResult } from '../src/election/domain/__fixtures__/scope-result.builder';
import { ELECTION_REPOSITORY } from '../src/election/domain/ports/election-repository';

/** Abre o SSE e coleta as mensagens recebidas. */
function openStream(app: INestApplication) {
  const { port } = app.getHttpServer().address() as AddressInfo;
  const chunks: string[] = [];
  return new Promise<{ res: IncomingMessage; chunks: string[]; close: () => void }>(
    (resolve, reject) => {
      const req = get(
        { port, path: '/election-feed/stream', headers: { Origin: 'http://localhost:3100' } },
        (res) => {
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => chunks.push(chunk));
          resolve({ res, chunks, close: () => req.destroy() });
        },
      );
      req.on('error', reject);
    },
  );
}

const waitFor = async (predicate: () => boolean, timeoutMs = 3000) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timeout esperando condição');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

const feedEvents = (chunks: string[]) =>
  chunks
    .join('')
    .split('\n\n')
    .filter((block) => block.startsWith('event: feed'));

describe('Election feed (e2e) — specs/election-results-feed', () => {
  let app: INestApplication;
  let repository: InMemoryElectionRepository;
  const env = { ...process.env };

  beforeAll(async () => {
    Logger.overrideLogger(false);
    delete process.env.CORS_ORIGINS;
    process.env.FEED_REFRESH_MS = '500';
    process.env.SSE_MAX_CLIENTS = '2';
    repository = new InMemoryElectionRepository();

    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ELECTION_REPOSITORY)
      .useValue(repository)
      .compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.listen(0);
  });

  afterAll(async () => {
    process.env = env;
    await app.close();
  });

  it('GET /election-feed com banco vazio → snapshot null, fonte falha (AC-14)', async () => {
    const res = await request(app.getHttpServer())
      .get('/election-feed')
      .set('Origin', 'http://localhost:3100')
      .expect(200);
    expect(res.body).toEqual({ sourceStatus: 'failed', snapshot: null });
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3100');
  });

  it('SSE: feed ao conectar, de novo só quando a versão muda; GET reflete os dados (AC-14, AC-15)', async () => {
    const stream = await openStream(app);
    try {
      expect(stream.res.statusCode).toBe(200);
      expect(stream.res.headers['content-type']).toMatch(/text\/event-stream/);
      await waitFor(() => feedEvents(stream.chunks).length === 1);

      // Sem mudança: nada novo após alguns ciclos de refresh.
      await new Promise((resolve) => setTimeout(resolve, 1200));
      expect(feedEvents(stream.chunks)).toHaveLength(1);

      await repository.saveAcceptedResult({
        result: makeResult(),
        contentHash: 'h',
        etag: null,
        rawPayload: {},
        receivedAt: new Date(),
        events: [],
        combatEvent: {
          cause: 'update',
          dedupeKey: 'update:x',
          occurredAt: new Date('2026-10-25T20:00:00-03:00'),
          red: 'attack',
          blue: 'hit',
        },
      });
      await repository.recordCycle('6258', { attemptAt: new Date(), success: true, error: null });

      await waitFor(() => feedEvents(stream.chunks).length === 2);
      const second = feedEvents(stream.chunks)[1];
      expect(second).toContain('id: 1');
      const data = JSON.parse(second.split('\ndata: ')[1]);
      expect(data.sourceStatus).toBe('ok');
      expect(data.snapshot.candidates[0]).toMatchObject({ name: 'LULA', side: 'red' });

      const res = await request(app.getHttpServer()).get('/election-feed').expect(200);
      expect(res.body.snapshot.states).toHaveLength(27);
      // Golpe no contrato do snapshot (combat-events FR-03; AC-06).
      expect(res.body.snapshot.combatEvents).toEqual([
        { id: expect.any(String), at: '2026-10-25T20:00:00-03:00', red: 'attack', blue: 'hit' },
      ]);
    } finally {
      stream.close();
    }
  });

  it('SSE acima do limite → 503 (AC-15)', async () => {
    const a = await openStream(app);
    const b = await openStream(app);
    try {
      await request(app.getHttpServer()).get('/election-feed/stream').expect(503);
    } finally {
      a.close();
      b.close();
    }
    // Desconectar libera vagas.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const c = await openStream(app);
    expect(c.res.statusCode).toBe(200);
    c.close();
  });

  it('OpenAPI documenta os dois endpoints e o DTO (AC-16)', () => {
    const doc = createSwaggerDocument(app);
    expect(doc.paths['/election-feed']?.get?.tags).toEqual(['election-feed']);
    expect(doc.paths['/election-feed/stream']?.get?.responses).toHaveProperty('503');
    expect(doc.components?.schemas).toHaveProperty('ElectionFeedResponseDto');
    expect(doc.components?.schemas).toHaveProperty('ElectionSnapshotDto');
    // Golpes (combat-events FR-03; AC-07).
    const snapshotDto = doc.components?.schemas?.ElectionSnapshotDto as {
      properties: Record<string, unknown>;
    };
    expect(snapshotDto.properties).toHaveProperty('combatEvents');
    const combatDto = doc.components?.schemas?.CombatEventDto as {
      properties: Record<string, { enum?: string[] }>;
    };
    expect(combatDto.properties.red.enum).toEqual([
      'attack',
      'hit',
      'knockback',
      'dodge',
      'victory',
      'defeat',
    ]);
  });
});
