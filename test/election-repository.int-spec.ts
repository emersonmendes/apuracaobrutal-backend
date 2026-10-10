// Integração do PrismaElectionRepository com o Postgres local (spec election-results-feed FR-05,
// AC-13). Requer `make infra` + `make migrate-deploy` e DATABASE_URL apontando para o banco.
import { randomInt } from 'node:crypto';
import { makeResult } from '../src/election/domain/__fixtures__/scope-result.builder';
import type { NewCombatEvent } from '../src/election/domain/combat-events';
import type { NewElectionEvent } from '../src/election/domain/election-events';
import { PrismaElectionRepository } from '../src/election/infra/adapters/prisma-election-repository';
import { PrismaService } from '../src/prisma/prisma.service';

const prisma = new PrismaService();
const repository = new PrismaElectionRepository(prisma);
// Código de eleição exclusivo do teste: nunca colide com dados reais (que têm até 6 dígitos).
const CODE = `9${randomInt(10_000_000, 99_999_999)}`;

const event = (dedupeKey: string, text = dedupeKey): NewElectionEvent => ({
  kind: 'update',
  dedupeKey,
  occurredAt: new Date('2026-10-25T20:00:00-03:00'),
  text,
  side: 'neutral',
});

const combat = (dedupeKey: string, red: NewCombatEvent['red'] = 'attack'): NewCombatEvent => ({
  cause: 'update',
  dedupeKey,
  occurredAt: new Date('2026-10-25T20:00:00-03:00'),
  red,
  blue: red === 'attack' ? 'hit' : 'attack',
});

function accepted(
  generationId: string,
  events: NewElectionEvent[] = [],
  combatEvent: NewCombatEvent | null = null,
) {
  return {
    result: makeResult({ electionCode: CODE, generationId, redPct: 50.123456789 }),
    contentHash: `hash-${generationId}`,
    etag: '"e"',
    rawPayload: { ele: CODE },
    receivedAt: new Date(),
    events,
    combatEvent,
  };
}

async function cleanup() {
  await prisma.candidateResult.deleteMany({ where: { scopeResult: { electionCode: CODE } } });
  await prisma.scopeResult.deleteMany({ where: { electionCode: CODE } });
  await prisma.electionEvent.deleteMany({ where: { electionCode: CODE } });
  await prisma.combatEvent.deleteMany({ where: { electionCode: CODE } });
  await prisma.scopeSourceState.deleteMany({ where: { electionCode: CODE } });
  await prisma.sourceStatus.deleteMany({ where: { electionCode: CODE } });
}

describe('PrismaElectionRepository (integração, AC-13)', () => {
  afterEach(cleanup);
  afterAll(() => prisma.$disconnect());

  it('grava resultado, candidatos, eventos, estado e versão juntos; lê de volta sem perda', async () => {
    await repository.saveAcceptedResult(accepted('1', [event('a'), event('b')]));

    const latest = await repository.getLatestScopeResults(CODE);
    expect(latest.get('br')?.contentHash).toBe('hash-1');
    expect(latest.get('br')?.result.candidates.find((c) => c.number === 13)?.validVotesPct).toBe(
      50.123456789,
    );
    expect((await repository.getRecentEvents(CODE, 20)).map((e) => e.text)).toEqual(['b', 'a']);
    expect((await repository.getSourceStatus(CODE))?.feedVersion).toBe(1);
    expect((await repository.getScopeStates(CODE)).get('br')?.lastEtag).toBe('"e"');
  });

  it('falha ao gravar um evento desfaz tudo daquele arquivo', async () => {
    const bad = accepted('1', [event('ok'), { ...event('ruim'), occurredAt: new Date(NaN) }]);
    await expect(repository.saveAcceptedResult(bad)).rejects.toThrow();

    expect(await prisma.scopeResult.count({ where: { electionCode: CODE } })).toBe(0);
    expect(await prisma.electionEvent.count({ where: { electionCode: CODE } })).toBe(0);
    expect(await repository.getSourceStatus(CODE)).toBeNull();
    expect((await repository.getScopeStates(CODE)).size).toBe(0);
  });

  it('reprocessar o mesmo generationId / dedupeKey não duplica nem sobe a versão', async () => {
    await repository.saveAcceptedResult(accepted('1', [event('a')]));
    await repository.saveAcceptedResult(accepted('1', [event('a')]));
    await repository.saveAcceptedResult(accepted('2', [event('a', 'repetido'), event('c')]));

    expect(await prisma.scopeResult.count({ where: { electionCode: CODE } })).toBe(2);
    expect((await repository.getRecentEvents(CODE, 20)).map((e) => e.text)).toEqual(['c', 'a']);
    expect((await repository.getSourceStatus(CODE))?.feedVersion).toBe(2);
  });

  it('histórico do br em ordem de aceitação e estado do worker', async () => {
    await repository.saveAcceptedResult(accepted('1'));
    await repository.saveAcceptedResult(accepted('2'));
    expect((await repository.getBrHistory(CODE, 10)).map((r) => r.generationId)).toEqual([
      '1',
      '2',
    ]);

    const until = new Date('2026-10-25T23:00:00Z');
    await repository.markNotFound(CODE, 'sp', until);
    await repository.markBlocked(CODE, until);
    await repository.recordCycle(CODE, { attemptAt: until, success: true, error: null });
    expect((await repository.getScopeStates(CODE)).get('sp')?.notFoundUntil).toEqual(until);
    expect(await repository.getSourceStatus(CODE)).toMatchObject({
      blockedUntil: until,
      lastSuccessAt: until,
      feedVersion: 2,
    });
  });

  describe('golpes (combat-events FR-02; AC-05, AC-06)', () => {
    it('golpe gravado junto com o arquivo e lido de volta', async () => {
      await repository.saveAcceptedResult(accepted('1', [event('a')], combat('a')));
      expect(await repository.getRecentCombatEvents(CODE, 20)).toEqual([
        {
          id: expect.any(String),
          occurredAt: new Date('2026-10-25T20:00:00-03:00'),
          red: 'attack',
          blue: 'hit',
        },
      ]);
    });

    it('falha ao gravar o golpe desfaz resultado, eventos e versão', async () => {
      const bad = accepted('1', [event('a')], { ...combat('a'), occurredAt: new Date(NaN) });
      await expect(repository.saveAcceptedResult(bad)).rejects.toThrow();

      expect(await prisma.scopeResult.count({ where: { electionCode: CODE } })).toBe(0);
      expect(await prisma.electionEvent.count({ where: { electionCode: CODE } })).toBe(0);
      expect(await prisma.combatEvent.count({ where: { electionCode: CODE } })).toBe(0);
      expect(await repository.getSourceStatus(CODE)).toBeNull();
    });

    it('mesmo arquivo ou mesma dedupeKey → um golpe só', async () => {
      await repository.saveAcceptedResult(accepted('1', [], combat('a')));
      await repository.saveAcceptedResult(accepted('1', [], combat('a')));
      await repository.saveAcceptedResult(accepted('2', [], combat('a', 'hit')));
      expect(await prisma.combatEvent.count({ where: { electionCode: CODE } })).toBe(1);
    });

    it('último golpe terminal, mesmo fora dos 20 mais recentes', async () => {
      expect(await repository.getLatestTerminalCombatEvent(CODE)).toBeNull();
      await repository.saveAcceptedResult(
        accepted('0', [], { ...combat('final'), red: 'victory', blue: 'defeat' }),
      );
      for (let i = 1; i <= 21; i += 1) {
        await repository.saveAcceptedResult(accepted(`${i}`, [], combat(`k${i}`)));
      }
      expect(await repository.getLatestTerminalCombatEvent(CODE)).toMatchObject({
        red: 'victory',
        blue: 'defeat',
      });
    });

    it('os 20 de maior seq, em ordem crescente', async () => {
      for (let i = 1; i <= 22; i += 1) {
        await repository.saveAcceptedResult(accepted(`${i}`, [], combat(`k${i}`)));
      }
      const rows = await prisma.combatEvent.findMany({
        where: { electionCode: CODE },
        orderBy: { seq: 'asc' },
      });
      const recent = await repository.getRecentCombatEvents(CODE, 20);
      expect(recent.map((r) => r.id)).toEqual(rows.slice(2).map((r) => r.id));
    });
  });
});
