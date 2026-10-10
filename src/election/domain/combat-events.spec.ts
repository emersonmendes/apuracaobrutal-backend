import { brt, makeResult, SIDES, type ResultOptions } from './__fixtures__/scope-result.builder';
import { toCombatEvent } from './combat-events';
import { generateEvents } from './election-events';
import type { ScopeResult } from './scope-result';

const LATER = brt('2026-10-25T21:00:00');

interface Case {
  name: string;
  previous: ResultOptions | null;
  next: ResultOptions;
  expected: { cause: string; red: string; blue: string } | null;
}

/** Troca os números de vermelho e azul (R-5). */
function mirror(options: ResultOptions): ResultOptions {
  const { redPct = 52.5, bluePct = 47.5, redElected, blueElected, ...rest } = options;
  return {
    ...rest,
    redPct: bluePct,
    bluePct: redPct,
    redElected: blueElected,
    blueElected: redElected,
  };
}

function combat(previousOptions: ResultOptions | null, nextOptions: ResultOptions) {
  const previous: ScopeResult | null = previousOptions ? makeResult(previousOptions) : null;
  const next = makeResult(nextOptions);
  const events = generateEvents(previous, next, SIDES);
  return { events, result: toCombatEvent(events, previous, next, SIDES) };
}

const notStarted: ResultOptions = { progress: 'n', countedSectionsPct: 0, totalizedAt: null };
const red50: ResultOptions = { redPct: 50.5, bluePct: 49.5 };

const CASES: Case[] = [
  {
    name: 'início da divulgação: sem referência para o update; lead_change "sai na frente"',
    previous: notStarted,
    next: { countedSectionsPct: 27, redPct: 50.12, bluePct: 49.88 },
    expected: { cause: 'lead_change', red: 'attack', blue: 'knockback' },
  },
  {
    name: 'update com m < 0,05 → dodge/dodge',
    previous: red50,
    next: { redPct: 50.53, bluePct: 49.47, totalizedAt: LATER },
    expected: { cause: 'update', red: 'dodge', blue: 'dodge' },
  },
  {
    name: 'update com m logo abaixo de 0,05 → dodge/dodge',
    previous: red50,
    next: { redPct: 50.549999, bluePct: 49.450001, totalizedAt: LATER },
    expected: { cause: 'update', red: 'dodge', blue: 'dodge' },
  },
  {
    name: 'update com m exatamente 0,05 (ruído de ponto flutuante 50,1 − 50,05) → attack/hit',
    previous: { redPct: 50.1, bluePct: 49.9 },
    next: { redPct: 50.05, bluePct: 49.95, totalizedAt: LATER },
    expected: { cause: 'update', red: 'hit', blue: 'attack' },
  },
  {
    name: 'update com 0,05 ≤ m < 0,5 → quem subiu ataca, outro hit',
    previous: red50,
    next: { redPct: 50.8, bluePct: 49.2, totalizedAt: LATER },
    expected: { cause: 'update', red: 'attack', blue: 'hit' },
  },
  {
    name: 'update com m exatamente 0,5 → attack/knockback',
    previous: red50,
    next: { redPct: 51, bluePct: 49, totalizedAt: LATER },
    expected: { cause: 'update', red: 'attack', blue: 'knockback' },
  },
  {
    name: 'update com variações iguais → dodge/dodge',
    previous: { redPct: 50.5, bluePct: 49.5 },
    next: { redPct: 50.5, bluePct: 49.5, totalizedAt: LATER },
    expected: { cause: 'update', red: 'dodge', blue: 'dodge' },
  },
  {
    name: 'update com anterior não divulgável (dv = n) e sem líder novo → sem golpe',
    previous: { disclosable: false },
    next: { redPct: 50, bluePct: 50, totalizedAt: LATER },
    expected: null,
  },
  {
    name: 'update sem anterior e empate → sem golpe',
    previous: null,
    next: { redPct: 50, bluePct: 50 },
    expected: null,
  },
  {
    name: 'precedência: update + lead_change → só lead_change',
    previous: red50,
    next: { redPct: 49.9, bluePct: 50.1, totalizedAt: LATER, generationId: '2000' },
    expected: { cause: 'lead_change', red: 'knockback', blue: 'attack' },
  },
  {
    name: 'precedência: final_result com vencedor + update + milestone → victory/defeat',
    previous: { ...red50, countedSectionsPct: 95 },
    next: {
      redPct: 51.02,
      bluePct: 48.98,
      totalizedAt: LATER,
      countedSectionsPct: 100,
      final: true,
      progress: 'f',
      redElected: true,
    },
    expected: { cause: 'final_result', red: 'victory', blue: 'defeat' },
  },
  {
    name: 'final_result sem vencedor + update → golpe do update',
    previous: { ...red50, countedSectionsPct: 95 },
    next: {
      redPct: 50.8,
      bluePct: 49.2,
      totalizedAt: LATER,
      countedSectionsPct: 99,
      final: true,
      noWinnerAssigned: true,
      redElected: true,
    },
    expected: { cause: 'update', red: 'attack', blue: 'hit' },
  },
  {
    name: 'final_result sem vencedor e sem update → sem golpe',
    previous: { ...red50, final: false },
    next: { ...red50, final: true, noWinnerAssigned: true },
    expected: null,
  },
  {
    name: 'state_completed com maior % do vermelho na UF → attack/hit',
    previous: { scope: 'sp', progress: 'p' },
    next: { scope: 'sp', progress: 'f', redPct: 55, bluePct: 45 },
    expected: { cause: 'state_completed', red: 'attack', blue: 'hit' },
  },
  {
    name: 'state_completed empatado → dodge/dodge',
    previous: { scope: 'sp', progress: 'p' },
    next: { scope: 'sp', progress: 'f', redPct: 50, bluePct: 50 },
    expected: { cause: 'state_completed', red: 'dodge', blue: 'dodge' },
  },
  {
    name: 'só milestone (sem update, sem troca de líder) → sem golpe',
    previous: { ...red50, countedSectionsPct: 20, totalizedAt: LATER },
    next: { ...red50, countedSectionsPct: 30, totalizedAt: LATER },
    expected: null,
  },
];

describe('toCombatEvent (R-2…R-4; AC-01…AC-03)', () => {
  it.each(CASES)('$name', ({ previous, next, expected }) => {
    const { result } = combat(previous, next);
    expect(result && { cause: result.cause, red: result.red, blue: result.blue }).toEqual(expected);
  });

  it('identidade e horário vêm do evento de apuração escolhido (R-6)', () => {
    const { events, result } = combat(red50, { redPct: 50.8, bluePct: 49.2, totalizedAt: LATER });
    const update = events.find((event) => event.kind === 'update');
    expect(result).toEqual(
      expect.objectContaining({ dedupeKey: update?.dedupeKey, occurredAt: update?.occurredAt }),
    );
    expect(result?.dedupeKey).toBe('update:2026-10-25T21:00:00-03:00');
  });

  it('sem eventos de apuração → sem golpe (R-1)', () => {
    expect(toCombatEvent([], null, makeResult(), SIDES)).toBeNull();
  });
});

describe('neutralidade: lados trocados geram o golpe espelhado (R-5; AC-04)', () => {
  it.each(CASES)('$name', ({ previous, next, expected }) => {
    const { result } = combat(previous && mirror(previous), mirror(next));
    expect(result && { cause: result.cause, red: result.red, blue: result.blue }).toEqual(
      expected && { cause: expected.cause, red: expected.blue, blue: expected.red },
    );
  });
});
