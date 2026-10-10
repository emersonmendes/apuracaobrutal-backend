import { brt, makeResult, SIDES } from './__fixtures__/scope-result.builder';
import { generateEvents, type NewElectionEvent } from './election-events';
import type { ScopeResult } from './scope-result';

const summary = (events: NewElectionEvent[]) =>
  events.map(({ kind, text, side, dedupeKey }) => ({ kind, text, side, dedupeKey }));

const notStarted = makeResult({ progress: 'n', countedSectionsPct: 0, totalizedAt: null });

describe('generateEvents — br (R-9, AC-09)', () => {
  it('início da divulgação: counting_started, update, milestone, lead_change "sai na frente"', () => {
    const next = makeResult({ countedSectionsPct: 27.34, redPct: 50.12, bluePct: 49.88 });
    expect(summary(generateEvents(notStarted, next, SIDES))).toEqual([
      {
        kind: 'counting_started',
        text: 'Começa a divulgação dos resultados do 2º turno',
        side: 'neutral',
        dedupeKey: 'counting_started',
      },
      {
        kind: 'update',
        text: 'Atualização do TSE: 27,3% das urnas apuradas',
        side: 'neutral',
        dedupeKey: 'update:2026-10-25T19:59:00-03:00',
      },
      {
        kind: 'milestone',
        text: '25% das urnas apuradas',
        side: 'neutral',
        dedupeKey: 'milestone:25',
      },
      {
        kind: 'lead_change',
        text: 'LULA sai na frente com 50,12%',
        side: 'red',
        dedupeKey: 'lead:1000',
      },
    ]);
  });

  it('occurredAt = totalizedAt (ou generatedAt sem totalização)', () => {
    const next = makeResult({ countedSectionsPct: 1 });
    expect(generateEvents(null, next, SIDES)[0].occurredAt).toEqual(next.totalizedAt);
  });

  it('só o maior marco cruzado', () => {
    const previous = makeResult({ countedSectionsPct: 20 });
    const next = makeResult({ countedSectionsPct: 91, totalizedAt: brt('2026-10-25T21:00:00') });
    const milestones = generateEvents(previous, next, SIDES).filter((e) => e.kind === 'milestone');
    expect(summary(milestones)).toEqual([
      {
        kind: 'milestone',
        text: '90% das urnas apuradas',
        side: 'neutral',
        dedupeKey: 'milestone:90',
      },
    ]);
  });

  it('virada → "assume a liderança"', () => {
    const previous = makeResult({ redPct: 50.5, bluePct: 49.5 });
    const next = makeResult({
      generationId: '2000',
      redPct: 49.9,
      bluePct: 50.1,
      totalizedAt: brt('2026-10-25T21:00:00'),
    });
    expect(generateEvents(previous, next, SIDES).find((e) => e.kind === 'lead_change')).toEqual(
      expect.objectContaining({
        text: 'FLAVIO BOLSONARO assume a liderança com 50,10%',
        side: 'blue',
        dedupeKey: 'lead:2000',
      }),
    );
  });

  it('mesmo líder ou empate → sem lead_change', () => {
    const previous = makeResult({ redPct: 50.5, bluePct: 49.5 });
    const same = makeResult({ redPct: 51, bluePct: 49, totalizedAt: brt('2026-10-25T21:00:00') });
    const tie = makeResult({ redPct: 50, bluePct: 50, totalizedAt: brt('2026-10-25T21:00:00') });
    expect(generateEvents(previous, same, SIDES).some((e) => e.kind === 'lead_change')).toBe(false);
    expect(generateEvents(previous, tie, SIDES).some((e) => e.kind === 'lead_change')).toBe(false);
  });

  it('mesmo totalizedAt → sem update', () => {
    const previous = makeResult();
    const next = makeResult({ generationId: '2' });
    expect(generateEvents(previous, next, SIDES)).toEqual([]);
  });

  it('não divulgável → nenhum evento de votos', () => {
    expect(
      generateEvents(null, makeResult({ disclosable: false, countedSectionsPct: 0 }), SIDES),
    ).toEqual([]);
  });

  it('final_result com vencedor fica por último (topo da lista)', () => {
    const previous = makeResult({ countedSectionsPct: 99.9, redPct: 51, bluePct: 49 });
    const next = makeResult({
      final: true,
      progress: 'f',
      countedSectionsPct: 100,
      redPct: 51.02,
      bluePct: 48.98,
      redElected: true,
      totalizedAt: brt('2026-10-25T23:40:00'),
    });
    const events = summary(generateEvents(previous, next, SIDES));
    expect(events.map((e) => e.kind)).toEqual(['update', 'milestone', 'final_result']);
    expect(events[2]).toEqual({
      kind: 'final_result',
      text: 'Resultado final: LULA vence com 51,02% dos votos válidos',
      side: 'red',
      dedupeKey: 'final_result',
    });
  });

  it('final_result sem atribuição de eleito', () => {
    const next = makeResult({ final: true, noWinnerAssigned: true, redElected: true });
    expect(generateEvents(makeResult(), next, SIDES)).toContainEqual(
      expect.objectContaining({
        kind: 'final_result',
        text: 'Totalização final concluída sem atribuição de eleito',
        side: 'neutral',
      }),
    );
  });
});

describe('generateEvents — UF (R-9)', () => {
  it('state_completed ao chegar a and = f', () => {
    const previous = makeResult({ scope: 'ac', progress: 'p' });
    const next = makeResult({ scope: 'ac', progress: 'f', redPct: 30.5, bluePct: 69.5 });
    expect(summary(generateEvents(previous, next, SIDES))).toEqual([
      {
        kind: 'state_completed',
        text: 'AC: apuração concluída — LULA 30,50% · FLAVIO BOLSONARO 69,50%',
        side: 'blue',
        dedupeKey: 'state_completed:ac',
      },
    ]);
  });

  it('empate na UF → neutral; UF já concluída → nada', () => {
    const done = makeResult({ scope: 'rr', progress: 'f', redPct: 50, bluePct: 50 });
    expect(generateEvents(null, done, SIDES)[0].side).toBe('neutral');
    expect(generateEvents(done, { ...done, generationId: '9' }, SIDES)).toEqual([]);
  });

  it('UF nunca gera eventos de br', () => {
    const next = makeResult({ scope: 'sp', countedSectionsPct: 60 });
    expect(generateEvents(null, next, SIDES)).toEqual([]);
  });
});

describe('simetria entre os lados (R-9, AC-09)', () => {
  /** Troca os números dos candidatos: o vermelho passa a ser o 22 e vice-versa. */
  const mirrored = { red: SIDES.blue, blue: SIDES.red };
  const swapSide = (side: string) => (side === 'red' ? 'blue' : side === 'blue' ? 'red' : side);

  const cases: Array<[string, ScopeResult | null, ScopeResult]> = [
    ['início', notStarted, makeResult({ countedSectionsPct: 30, redPct: 55, bluePct: 45 })],
    [
      'virada',
      makeResult({ redPct: 55, bluePct: 45 }),
      makeResult({ redPct: 45, bluePct: 55, totalizedAt: brt('2026-10-25T21:00:00') }),
    ],
    [
      'final',
      makeResult(),
      makeResult({ final: true, blueElected: true, totalizedAt: brt('2026-10-25T23:00:00') }),
    ],
    ['UF', null, makeResult({ scope: 'mg', progress: 'f', redPct: 48, bluePct: 52 })],
  ];

  it.each(cases)('%s: mesmos tipos e quantidade, lados trocados', (_label, previous, next) => {
    const normal = generateEvents(previous, next, SIDES);
    const swapped = generateEvents(previous, next, mirrored);
    expect(swapped.map((e) => e.kind)).toEqual(normal.map((e) => e.kind));
    expect(swapped.map((e) => e.side)).toEqual(normal.map((e) => swapSide(e.side)));
  });
});
