import { brt, makeResult, SIDES, TEST_CONFIG } from './__fixtures__/scope-result.builder';
import { buildSnapshot } from './build-snapshot';
import type { Scope } from './election-config';
import type { StoredCombatEvent } from './combat-events';
import type { StoredElectionEvent } from './election-events';
import type { ScopeResult } from './scope-result';
import { buildTimeline, TIMELINE_LIMIT } from './timeline';

function snapshot(
  results: ScopeResult[],
  extra: Partial<Parameters<typeof buildSnapshot>[0]> = {},
) {
  const latestByScope = new Map<Scope, ScopeResult>(results.map((r) => [r.scope, r]));
  return buildSnapshot({
    latestByScope,
    brHistory: results.filter((r) => r.scope === 'br'),
    events: [],
    combatEvents: [],
    config: TEST_CONFIG,
    ...extra,
  });
}

describe('buildSnapshot (FR-06, AC-07, AC-08)', () => {
  it('sem br → null', () => {
    expect(snapshot([makeResult({ scope: 'sp' })])).toBeNull();
  });

  it('monta o contrato a partir do br', () => {
    const result = snapshot([makeResult({ redPct: 50.32, bluePct: 49.68 })])!;
    expect(result).toMatchObject({
      origin: 'official',
      election: { year: 2026, office: 'PRESIDENTE', scope: 'BRASIL', round: 2 },
      status: 'partial',
      updatedAt: '2026-10-25T19:59:00-03:00',
      countedSectionsPct: 40,
      winnerId: null,
    });
    expect(result.candidates).toEqual([
      {
        id: '280002542548',
        name: 'LULA',
        party: 'PT',
        side: 'red',
        votes: 251600,
        validVotesPct: 50.32,
        imageUrl: 'https://resultados.tse.jus.br/oficial/ele2026/6258/fotos/br/280002542548.jpeg',
      },
      expect.objectContaining({ name: 'FLAVIO BOLSONARO', party: 'PL', side: 'blue' }),
    ]);
  });

  it('lados vêm da configuração, não da ordem no arquivo nem dos votos (R-5)', () => {
    const result = snapshot([makeResult({ redPct: 10, bluePct: 90 })], {
      config: { ...TEST_CONFIG, sides: { red: 22, blue: 13 } },
    })!;
    expect(result.candidates.map((c) => [c.side, c.name])).toEqual([
      ['red', 'FLAVIO BOLSONARO'],
      ['blue', 'LULA'],
    ]);
  });

  it('percentuais exatamente os do TSE, mesmo sem bater com os votos (R-6)', () => {
    const br = makeResult();
    br.candidates[1] = { ...br.candidates[1], votes: 1, validVotesPct: 77.777777777 };
    expect(snapshot([br])!.candidates[0]).toMatchObject({ votes: 1, validVotesPct: 77.777777777 });
  });

  it('dv = n → votos zerados e not_started', () => {
    const result = snapshot([makeResult({ disclosable: false })])!;
    expect(result.status).toBe('not_started');
    expect(result.candidates.map((c) => [c.votes, c.validVotesPct])).toEqual([
      [0, 0],
      [0, 0],
    ]);
  });

  it('updatedAt usa generatedAt quando não há totalização (R-8)', () => {
    expect(snapshot([makeResult({ totalizedAt: null })])!.updatedAt).toBe(
      '2026-10-25T20:00:00-03:00',
    );
  });

  it('27 UFs em ordem alfabética, null para ausentes ou sem votos', () => {
    const result = snapshot([
      makeResult(),
      makeResult({ scope: 'sp', redPct: 40, bluePct: 60, countedSectionsPct: 55.5 }),
      makeResult({ scope: 'ac', validVotes: 0 }),
    ])!;
    expect(result.states).toHaveLength(27);
    expect(result.states[0]).toEqual({
      uf: 'AC',
      countedSectionsPct: 40,
      redPct: null,
      bluePct: null,
    });
    expect(result.states.find((s) => s.uf === 'SP')).toEqual({
      uf: 'SP',
      countedSectionsPct: 55.5,
      redPct: 40,
      bluePct: 60,
    });
    expect(result.states.find((s) => s.uf === 'RJ')).toEqual({
      uf: 'RJ',
      countedSectionsPct: 0,
      redPct: null,
      bluePct: null,
    });
  });

  it('featuredStates por eleitorado, desempate pela sigla, só UFs com arquivo', () => {
    const result = snapshot([
      makeResult(),
      makeResult({ scope: 'rj', electorate: 500 }),
      makeResult({ scope: 'sp', electorate: 900 }),
      makeResult({ scope: 'ba', electorate: 500 }),
    ])!;
    expect(result.featuredStates).toEqual(['SP', 'BA', 'RJ']);
  });

  it('origin simulated se qualquer escopo for f = s (R-4)', () => {
    expect(snapshot([makeResult(), makeResult({ scope: 'sp', phase: 's' })])!.origin).toBe(
      'simulated',
    );
  });

  it('final com vencedor', () => {
    const result = snapshot([makeResult({ final: true, blueElected: true })])!;
    expect(result).toMatchObject({ status: 'final', winnerId: '280002551544' });
  });

  it('eventos limitados a 20, mantendo a ordem recebida', () => {
    const events: StoredElectionEvent[] = Array.from({ length: 25 }, (_, i) => ({
      id: `e${i}`,
      occurredAt: brt('2026-10-25T20:00:00'),
      text: `evento ${i}`,
      side: 'neutral',
    }));
    const result = snapshot([makeResult()], { events })!;
    expect(result.events).toHaveLength(20);
    expect(result.events[0]).toEqual({
      id: 'e0',
      at: '2026-10-25T20:00:00-03:00',
      text: 'evento 0',
      side: 'neutral',
    });
  });
});

describe('buildTimeline (R-12, AC-10)', () => {
  it('um ponto por totalizedAt, o último aceito vence, em ordem cronológica', () => {
    const history = [
      makeResult({ totalizedAt: brt('2026-10-25T20:10:00'), redPct: 51, bluePct: 49 }),
      makeResult({ totalizedAt: brt('2026-10-25T20:00:00'), redPct: 50, bluePct: 50 }),
      makeResult({ totalizedAt: brt('2026-10-25T20:10:00'), redPct: 52, bluePct: 48 }),
      makeResult({ totalizedAt: null }),
      makeResult({ progress: 'n', totalizedAt: brt('2026-10-25T19:00:00') }),
    ];
    expect(buildTimeline(history, SIDES)).toEqual([
      { at: '2026-10-25T20:00:00-03:00', redPct: 50, bluePct: 50 },
      { at: '2026-10-25T20:10:00-03:00', redPct: 52, bluePct: 48 },
    ]);
  });

  it('limita aos 500 mais recentes', () => {
    const history = Array.from({ length: 510 }, (_, i) =>
      makeResult({ totalizedAt: new Date(Date.UTC(2026, 9, 25, 22, 0, i)) }),
    );
    const timeline = buildTimeline(history, SIDES);
    expect(timeline).toHaveLength(TIMELINE_LIMIT);
    expect(timeline[0].at).toBe('2026-10-25T19:00:10-03:00');
  });

  describe('combatEvents (combat-events FR-03; AC-06)', () => {
    it('sem golpes → []', () => {
      expect(snapshot([makeResult()])!.combatEvents).toEqual([]);
    });

    it('os 20 mais recentes, na ordem recebida (seq crescente), com at em Brasília', () => {
      const combatEvents: StoredCombatEvent[] = Array.from({ length: 25 }, (_, i) => ({
        id: `c${i}`,
        occurredAt: new Date(Date.UTC(2026, 9, 25, 22, i)),
        red: i % 2 === 0 ? 'attack' : 'hit',
        blue: i % 2 === 0 ? 'hit' : 'attack',
      }));
      const result = snapshot([makeResult()], { combatEvents })!;
      expect(result.combatEvents).toHaveLength(20);
      expect(result.combatEvents[0]).toEqual({
        id: 'c5',
        at: '2026-10-25T19:05:00-03:00',
        red: 'hit',
        blue: 'attack',
      });
      expect(result.combatEvents[19].id).toBe('c24');
    });

    const combats = (count: number, from = 0): StoredCombatEvent[] =>
      Array.from({ length: count }, (_, i) => ({
        id: `c${from + i}`,
        occurredAt: new Date(Date.UTC(2026, 9, 25, 23, from + i)),
        red: 'attack',
        blue: 'hit',
      }));
    const terminal: StoredCombatEvent = {
      id: 'final',
      occurredAt: new Date(Date.UTC(2026, 9, 25, 22, 59)),
      red: 'victory',
      blue: 'defeat',
    };

    it('terminal fora da janela substitui o mais antigo e vai para o início', () => {
      const result = snapshot([makeResult()], {
        combatEvents: combats(25),
        terminalCombatEvent: terminal,
      })!;
      expect(result.combatEvents).toHaveLength(20);
      expect(result.combatEvents[0]).toMatchObject({ id: 'final', red: 'victory' });
      expect(result.combatEvents[1].id).toBe('c6');
      expect(result.combatEvents[19].id).toBe('c24');
    });

    it('terminal dentro da janela não é repetido; janela incompleta só ganha o terminal', () => {
      const inside = snapshot([makeResult()], {
        combatEvents: [terminal, ...combats(3)],
        terminalCombatEvent: terminal,
      })!;
      expect(inside.combatEvents.map((c) => c.id)).toEqual(['final', 'c0', 'c1', 'c2']);
    });
  });
});
