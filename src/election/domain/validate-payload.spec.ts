import {
  BR_21270_SIMULATED,
  BR_6257_FINAL,
  BR_6258_NOT_STARTED,
  SP_6258_NOT_STARTED,
} from './__fixtures__/tse-files';
import { SIDES } from './__fixtures__/scope-result.builder';
import { parseBrasiliaDateTime, parseTseDecimal, parseTseInt, toBrasiliaIso } from './tse-values';
import { validatePayload } from './validate-payload';

const ctx = { electionCode: '6258', scope: 'br' as const, sides: SIDES };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('valores do TSE (R-2, R-8, AC-04)', () => {
  it('converte inteiros e decimais com vírgula', () => {
    expect(parseTseInt('58912401')).toBe(58912401);
    expect(parseTseDecimal('47,027772356')).toBe(47.027772356);
    expect(parseTseDecimal('100')).toBe(100);
  });

  it.each(['', '1.5', '-1', '1,', ',5', ' 1', 'abc'])('rejeita %p', (raw) => {
    expect(parseTseDecimal(raw)).toBeNull();
  });

  it('horário de Brasília → instante com -03:00', () => {
    const date = parseBrasiliaDateTime('05/10/2026', '12:51:05');
    expect(date).toEqual(new Date('2026-10-05T12:51:05-03:00'));
    expect(toBrasiliaIso(date as Date)).toBe('2026-10-05T12:51:05-03:00');
  });

  it('dt/ht vazios → null; só um vazio ou data impossível → inválido', () => {
    expect(parseBrasiliaDateTime('', '')).toBeNull();
    expect(parseBrasiliaDateTime('05/10/2026', '')).toBeUndefined();
    expect(parseBrasiliaDateTime('31/02/2026', '10:00:00')).toBeUndefined();
    expect(parseBrasiliaDateTime('2026-10-05', '10:00:00')).toBeUndefined();
  });
});

describe('validatePayload — arquivos reais (FR-04, AC-04)', () => {
  it('normaliza o br 6258 ainda não iniciado', () => {
    const outcome = validatePayload(BR_6258_NOT_STARTED, ctx);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result).toMatchObject({
      scope: 'br',
      round: 2,
      phase: 'o',
      generationId: '3396337',
      generatedAt: new Date('2026-10-10T12:55:44-03:00'),
      totalizedAt: null,
      disclosable: true,
      progress: 'n',
      final: false,
      sectionsTotal: 393882,
      sectionsCounted: 0,
      countedSectionsPct: 0,
      electorate: 126154240,
      validVotes: 0,
    });
    expect(outcome.result.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ number: 13, ballotName: 'LULA', party: 'PT', votes: 0 }),
        expect.objectContaining({ number: 22, ballotName: 'FLAVIO BOLSONARO', party: 'PL' }),
      ]),
    );
  });

  it('normaliza o br 6257 apurado (decimais exatos, eleito)', () => {
    const outcome = validatePayload(BR_6257_FINAL, { ...ctx, electionCode: '6257' });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const lula = outcome.result.candidates.find((c) => c.number === 13);
    expect(lula).toEqual({
      number: 13,
      sqcand: '280002542548',
      ballotName: 'LULA',
      party: 'PT',
      votes: 53879538,
      validVotesPct: 45.162767911,
      elected: true,
      situation: '2º turno',
    });
    expect(outcome.result.totalizedAt).toEqual(new Date('2026-10-05T12:51:05-03:00'));
    expect(outcome.result.final).toBe(true);
    expect(outcome.result.progress).toBe('f');
    expect(outcome.result.candidates).toHaveLength(3);
  });

  it('aceita UF e o simulado (f = s), preservando o nome malicioso como texto', () => {
    expect(validatePayload(SP_6258_NOT_STARTED, { ...ctx, scope: 'sp' }).ok).toBe(true);
    const sim = validatePayload(BR_21270_SIMULATED, {
      electionCode: '21270',
      scope: 'br',
      sides: { red: 57, blue: 89 },
    });
    expect(sim.ok).toBe(true);
    if (!sim.ok) return;
    expect(sim.result.phase).toBe('s');
    expect(sim.result.candidates.map((c) => c.ballotName)).toContain(
      'Candidato string 1234!@#$"TSE"',
    );
  });
});

describe('validatePayload — rejeições (R-2, AC-03)', () => {
  const rejects = (mutate: (payload: Record<string, unknown>) => void, scope = 'br' as const) => {
    const payload = clone(BR_6258_NOT_STARTED) as unknown as Record<string, unknown>;
    mutate(payload);
    return validatePayload(payload, { ...ctx, scope });
  };

  it.each<[string, (p: Record<string, unknown>) => void]>([
    ['ele diferente', (p) => (p.ele = '6257')],
    ['cdabr diferente', (p) => (p.cdabr = 'sp')],
    ['tpabr diferente', (p) => (p.tpabr = 'uf')],
    ['f inválido', (p) => (p.f = 'x')],
    ['t inválido', (p) => (p.t = '3')],
    ['and inválido', (p) => (p.and = 'x')],
    ['dv inválido', (p) => (p.dv = '')],
    ['dg inválido', (p) => (p.dg = '2026-10-10')],
    ['só dt preenchido', (p) => (p.dt = '10/10/2026')],
    ['inteiro malformado', (p) => ((p.s as Record<string, unknown>).ts = '1.000')],
    ['percentual > 100', (p) => ((p.s as Record<string, unknown>).pstn = '100,5')],
    ['sem cargo 1', (p) => ((p.carg as Array<Record<string, unknown>>)[0].cd = '3')],
  ])('%s', (_label, mutate) => {
    expect(rejects(mutate).ok).toBe(false);
  });

  it('candidato vermelho ou azul ausente', () => {
    const outcome = validatePayload(BR_6258_NOT_STARTED, { ...ctx, sides: { red: 13, blue: 99 } });
    expect(outcome).toEqual({ ok: false, reasons: ['candidato blue (99) aparece 0 vez(es)'] });
  });

  it('payload que não é objeto', () => {
    expect(validatePayload(null, ctx).ok).toBe(false);
  });
});
