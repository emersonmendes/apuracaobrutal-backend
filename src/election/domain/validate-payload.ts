// Validação (R-2) e normalização (FR-04) do payload EA20 já verificado (R-1).
// Spec: election-results-feed.
import type { CandidateSides, Scope } from './election-config';
import type { CandidateResult, Phase, Progress, ScopeResult } from './scope-result';
import { parseBrasiliaDateTime, parseTseInt, parseTsePct } from './tse-values';

export interface ValidationContext {
  electionCode: string;
  scope: Scope;
  sides: CandidateSides;
}

export type ValidationOutcome =
  { ok: true; result: ScopeResult } | { ok: false; reasons: string[] };

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Valida o conteúdo de um arquivo EA20 e devolve o {@link ScopeResult} normalizado, ou a lista
 * de motivos de rejeição. Não decide status nem eventos.
 */
export function validatePayload(payload: unknown, ctx: ValidationContext): ValidationOutcome {
  const reasons: string[] = [];
  const fail = (reason: string) => {
    reasons.push(reason);
    return null;
  };

  if (!isObj(payload)) return { ok: false, reasons: ['payload não é um objeto'] };

  if (payload.ele !== ctx.electionCode) fail(`ele "${String(payload.ele)}" ≠ ${ctx.electionCode}`);
  if (payload.cdabr !== ctx.scope) fail(`cdabr "${String(payload.cdabr)}" ≠ ${ctx.scope}`);
  const expectedTpabr = ctx.scope === 'br' ? 'br' : 'uf';
  if (payload.tpabr !== expectedTpabr) fail(`tpabr "${String(payload.tpabr)}" ≠ ${expectedTpabr}`);

  const phase = oneOf<Phase>(payload.f, ['o', 's']) ?? fail('f inválido');
  const round = oneOf(payload.t, ['1', '2']) ?? fail('t inválido');
  const dv = oneOf(payload.dv, ['s', 'n']) ?? fail('dv inválido');
  const tf = oneOf(payload.tf, ['s', 'n']) ?? fail('tf inválido');
  const progress = oneOf<Progress>(payload.and, ['n', 'p', 'f']) ?? fail('and inválido');
  const generationId = parseTseInt(payload.idg) !== null ? (payload.idg as string) : fail('idg');

  const generatedAt = parseBrasiliaDateTime(payload.dg, payload.hg);
  if (!generatedAt) fail('dg/hg inválidos');
  const totalizedAt = parseBrasiliaDateTime(payload.dt, payload.ht);
  if (totalizedAt === undefined) fail('dt/ht inválidos');

  const sections = isObj(payload.s) ? payload.s : {};
  const sectionsTotal = parseTseInt(sections.ts) ?? fail('s.ts inválido');
  const sectionsCounted = parseTseInt(sections.st) ?? fail('s.st inválido');
  const countedSectionsPct = parseTsePct(sections.pstn) ?? fail('s.pstn inválido');
  const electorate = parseTseInt(isObj(payload.e) ? payload.e.te : undefined) ?? fail('e.te');
  const validVotes = parseTseInt(isObj(payload.v) ? payload.v.vv : undefined) ?? fail('v.vv');

  const office = array(payload.carg).find((c) => isObj(c) && c.cd === '1');
  if (!isObj(office)) fail('carg com cd = 1 ausente');

  const candidates: CandidateResult[] = [];
  for (const agr of array(isObj(office) ? office.agr : undefined)) {
    for (const par of array(isObj(agr) ? agr.par : undefined)) {
      if (!isObj(par)) continue;
      const party = text(par.sg) ?? fail('par.sg inválido');
      for (const cand of array(par.cand)) {
        if (!isObj(cand)) {
          fail('cand inválido');
          continue;
        }
        const number = parseTseInt(cand.n);
        const votes = parseTseInt(cand.vap);
        const validVotesPct = parseTsePct(cand.pvapn);
        const sqcand = parseTseInt(cand.sqcand) !== null ? (cand.sqcand as string) : null;
        const ballotName = text(cand.nmu);
        if (number === null || votes === null || validVotesPct === null || !sqcand || !ballotName) {
          fail(`candidato "${String(cand.n)}" com campos inválidos`);
          continue;
        }
        candidates.push({
          number,
          sqcand,
          ballotName,
          party: party ?? '',
          votes,
          validVotesPct,
          elected: cand.e === 's',
          situation: text(cand.st) || null,
        });
      }
    }
  }

  for (const [side, number] of Object.entries(ctx.sides)) {
    const count = candidates.filter((c) => c.number === number).length;
    if (count !== 1) fail(`candidato ${side} (${number}) aparece ${count} vez(es)`);
  }

  if (reasons.length > 0) return { ok: false, reasons };

  return {
    ok: true,
    result: {
      electionCode: ctx.electionCode,
      scope: ctx.scope,
      round: round === '2' ? 2 : 1,
      phase: phase as Phase,
      generationId: generationId as string,
      generatedAt: generatedAt as Date,
      totalizedAt: totalizedAt as Date | null,
      disclosable: dv === 's',
      progress: progress as Progress,
      final: tf === 's',
      noWinnerAssigned: payload.esae === 's',
      sectionsTotal: sectionsTotal as number,
      sectionsCounted: sectionsCounted as number,
      countedSectionsPct: countedSectionsPct as number,
      electorate: electorate as number,
      validVotes: validVotes as number,
      candidates,
    },
  };
}
