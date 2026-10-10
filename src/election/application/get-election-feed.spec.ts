import { makeResult, TEST_CONFIG } from '../domain/__fixtures__/scope-result.builder';
import { InMemoryElectionRepository } from './__fakes__/in-memory-election-repository';
import { GetElectionFeed } from './get-election-feed';

const NOW = new Date('2026-10-25T23:00:00Z');

function setup() {
  const repository = new InMemoryElectionRepository();
  const feed = new GetElectionFeed(repository, { now: () => NOW }, TEST_CONFIG);
  return { repository, feed };
}

describe('GetElectionFeed (FR-06, FR-07, R-10; AC-11, AC-14)', () => {
  it('banco vazio → snapshot null e fonte falha', async () => {
    const { feed } = setup();
    expect(await feed.getFeed()).toEqual({
      feedVersion: 0,
      sourceStatus: 'failed',
      snapshot: null,
    });
  });

  it('com dados e sucesso recente → ok + snapshot', async () => {
    const { repository, feed } = setup();
    await repository.saveAcceptedResult({
      result: makeResult(),
      contentHash: 'h',
      etag: null,
      rawPayload: {},
      receivedAt: NOW,
      events: [],
      combatEvent: null,
    });
    await repository.recordCycle('6258', {
      attemptAt: new Date(NOW.getTime() - 30_000),
      success: true,
      error: null,
    });

    const response = await feed.getFeed();
    expect(response.feedVersion).toBe(1);
    expect(response.sourceStatus).toBe('ok');
    expect(response.snapshot?.candidates.map((c) => c.name)).toEqual(['LULA', 'FLAVIO BOLSONARO']);
  });

  it('último sucesso fora da janela de frescor → failed', async () => {
    const { repository, feed } = setup();
    await repository.recordCycle('6258', {
      attemptAt: new Date(NOW.getTime() - 91_000),
      success: true,
      error: null,
    });
    expect(await feed.getVersion()).toEqual({ feedVersion: 0, sourceStatus: 'failed' });
  });

  describe('golpes no snapshot (combat-events FR-03; AC-06)', () => {
    const save = (repository: InMemoryElectionRepository, i: number, red: 'attack' | 'victory') =>
      repository.saveAcceptedResult({
        result: makeResult({ generationId: `${i}` }),
        contentHash: `h${i}`,
        etag: null,
        rawPayload: {},
        receivedAt: NOW,
        events: [],
        combatEvent: {
          cause: red === 'victory' ? 'final_result' : 'state_completed',
          dedupeKey: `k${i}`,
          occurredAt: new Date(NOW.getTime() + i * 1000),
          red,
          blue: red === 'victory' ? 'defeat' : 'hit',
        },
      });

    it('golpe gravado aparece em snapshot.combatEvents', async () => {
      const { repository, feed } = setup();
      await save(repository, 1, 'attack');
      const { snapshot } = await feed.getFeed();
      expect(snapshot?.combatEvents).toEqual([
        { id: expect.any(String), at: expect.any(String), red: 'attack', blue: 'hit' },
      ]);
    });

    it('25 golpes depois do final: o terminal continua no início', async () => {
      const { repository, feed } = setup();
      await save(repository, 0, 'victory');
      for (let i = 1; i <= 25; i += 1) await save(repository, i, 'attack');
      const { snapshot } = await feed.getFeed();
      expect(snapshot?.combatEvents).toHaveLength(20);
      expect(snapshot?.combatEvents[0]).toMatchObject({ red: 'victory', blue: 'defeat' });
      expect(snapshot?.combatEvents.slice(1).every((c) => c.red === 'attack')).toBe(true);
    });
  });
});
