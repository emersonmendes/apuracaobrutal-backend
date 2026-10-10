import {
  Prisma,
  type CandidateResult as CandidateRow,
  type ScopeResult as ScopeRow,
} from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import { TERMINAL_MOVES, type StoredCombatEvent } from '../../domain/combat-events';
import type { Scope } from '../../domain/election-config';
import type { StoredElectionEvent } from '../../domain/election-events';
import type { CombatMove, EventSide } from '../../domain/election-snapshot';
import type {
  AcceptedResult,
  ElectionRepository,
  ScopeSourceStateRecord,
  SourceStatusRecord,
} from '../../domain/ports/election-repository';
import type { Phase, Progress, ScopeResult, StoredScopeResult } from '../../domain/scope-result';

type ScopeRowWithCandidates = ScopeRow & { candidates: CandidateRow[] };

function toDomain(row: ScopeRowWithCandidates): ScopeResult {
  return {
    electionCode: row.electionCode,
    scope: row.scope as Scope,
    round: row.round === 2 ? 2 : 1,
    phase: row.phase as Phase,
    generationId: row.generationId,
    generatedAt: row.generatedAt,
    totalizedAt: row.totalizedAt,
    disclosable: row.disclosable,
    progress: row.progress as Progress,
    final: row.final,
    noWinnerAssigned: row.noWinnerAssigned,
    sectionsTotal: row.sectionsTotal,
    sectionsCounted: row.sectionsCounted,
    countedSectionsPct: row.countedSectionsPct.toNumber(),
    electorate: row.electorate,
    validVotes: row.validVotes,
    candidates: row.candidates.map((c) => ({
      number: c.number,
      sqcand: c.sqcand,
      ballotName: c.ballotName,
      party: c.party,
      votes: c.votes,
      validVotesPct: c.validVotesPct.toNumber(),
      elected: c.elected,
      situation: c.situation,
    })),
  };
}

/**
 * Adapter Prisma da porta {@link ElectionRepository} (spec election-results-feed FR-05; Fluxo 3).
 * Só persistência — nenhuma regra de negócio.
 */
export class PrismaElectionRepository implements ElectionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getSourceStatus(electionCode: string): Promise<SourceStatusRecord | null> {
    return this.prisma.sourceStatus.findUnique({
      where: { electionCode },
      select: {
        lastAttemptAt: true,
        lastSuccessAt: true,
        lastError: true,
        blockedUntil: true,
        feedVersion: true,
      },
    });
  }

  async getScopeStates(electionCode: string): Promise<Map<Scope, ScopeSourceStateRecord>> {
    const rows = await this.prisma.scopeSourceState.findMany({ where: { electionCode } });
    return new Map(
      rows.map((row) => [
        row.scope as Scope,
        {
          lastGeneratedAt: row.lastGeneratedAt,
          lastEtag: row.lastEtag,
          lastSeenAt: row.lastSeenAt,
          notFoundUntil: row.notFoundUntil,
        },
      ]),
    );
  }

  async getLatestScopeResults(electionCode: string): Promise<Map<Scope, StoredScopeResult>> {
    const rows = await this.prisma.scopeResult.findMany({
      where: { electionCode },
      distinct: ['scope'],
      orderBy: [{ scope: 'asc' }, { id: 'desc' }],
      include: { candidates: true },
    });
    return new Map(
      rows.map((row) => [
        row.scope as Scope,
        { result: toDomain(row), contentHash: row.contentHash },
      ]),
    );
  }

  async getBrHistory(electionCode: string, limit: number): Promise<ScopeResult[]> {
    const rows = await this.prisma.scopeResult.findMany({
      where: { electionCode, scope: 'br' },
      orderBy: { id: 'desc' },
      take: limit,
      include: { candidates: true },
    });
    return rows.reverse().map(toDomain);
  }

  async getRecentEvents(electionCode: string, limit: number): Promise<StoredElectionEvent[]> {
    const rows = await this.prisma.electionEvent.findMany({
      where: { electionCode },
      orderBy: [{ occurredAt: 'desc' }, { seq: 'desc' }],
      take: limit,
    });
    return rows.map((row) => ({
      id: row.id,
      occurredAt: row.occurredAt,
      text: row.text,
      side: row.side as EventSide,
    }));
  }

  async getRecentCombatEvents(electionCode: string, limit: number): Promise<StoredCombatEvent[]> {
    const rows = await this.prisma.combatEvent.findMany({
      where: { electionCode },
      orderBy: { seq: 'desc' },
      take: limit,
    });
    return rows.reverse().map((row) => ({
      id: row.id,
      occurredAt: row.occurredAt,
      red: row.red as CombatMove,
      blue: row.blue as CombatMove,
    }));
  }

  async getLatestTerminalCombatEvent(electionCode: string): Promise<StoredCombatEvent | null> {
    const moves = [...TERMINAL_MOVES];
    const row = await this.prisma.combatEvent.findFirst({
      where: { electionCode, OR: [{ red: { in: moves } }, { blue: { in: moves } }] },
      orderBy: { seq: 'desc' },
    });
    return row
      ? {
          id: row.id,
          occurredAt: row.occurredAt,
          red: row.red as CombatMove,
          blue: row.blue as CombatMove,
        }
      : null;
  }

  async saveAcceptedResult(accepted: AcceptedResult): Promise<void> {
    const { result } = accepted;
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.scopeResult.findUnique({
        where: {
          electionCode_scope_generationId: {
            electionCode: result.electionCode,
            scope: result.scope,
            generationId: result.generationId,
          },
        },
        select: { id: true },
      });

      // Mesmo arquivo já gravado (reprocessamento): a transação anterior gravou tudo junto.
      if (existing) return;

      await tx.scopeResult.create({
        data: {
          electionCode: result.electionCode,
          scope: result.scope,
          round: result.round,
          phase: result.phase,
          generationId: result.generationId,
          generatedAt: result.generatedAt,
          totalizedAt: result.totalizedAt,
          disclosable: result.disclosable,
          progress: result.progress,
          final: result.final,
          noWinnerAssigned: result.noWinnerAssigned,
          sectionsTotal: result.sectionsTotal,
          sectionsCounted: result.sectionsCounted,
          countedSectionsPct: new Prisma.Decimal(result.countedSectionsPct),
          electorate: result.electorate,
          validVotes: result.validVotes,
          contentHash: accepted.contentHash,
          etag: accepted.etag,
          rawPayload: accepted.rawPayload as Prisma.InputJsonValue,
          receivedAt: accepted.receivedAt,
          candidates: {
            create: result.candidates.map((c) => ({
              number: c.number,
              sqcand: c.sqcand,
              ballotName: c.ballotName,
              party: c.party,
              votes: c.votes,
              validVotesPct: new Prisma.Decimal(c.validVotesPct),
              elected: c.elected,
              situation: c.situation,
            })),
          },
        },
      });

      // Inserção um a um mantém o `seq` na ordem da R-9; `skipDuplicates` torna idempotente.
      for (const event of accepted.events) {
        await tx.electionEvent.createMany({
          data: [
            {
              electionCode: result.electionCode,
              kind: event.kind,
              dedupeKey: event.dedupeKey,
              occurredAt: event.occurredAt,
              text: event.text,
              side: event.side,
            },
          ],
          skipDuplicates: true,
        });
      }

      // Golpe na mesma transação (combat-events FR-02); chave repetida é ignorada (R-6).
      if (accepted.combatEvent) {
        const { cause, dedupeKey, occurredAt, red, blue } = accepted.combatEvent;
        await tx.combatEvent.createMany({
          data: [{ electionCode: result.electionCode, cause, dedupeKey, occurredAt, red, blue }],
          skipDuplicates: true,
        });
      }

      const scopeState = {
        lastGeneratedAt: result.generatedAt,
        lastEtag: accepted.etag,
        lastSeenAt: accepted.receivedAt,
        notFoundUntil: null,
      };
      await tx.scopeSourceState.upsert({
        where: {
          electionCode_scope: { electionCode: result.electionCode, scope: result.scope },
        },
        create: { electionCode: result.electionCode, scope: result.scope, ...scopeState },
        update: scopeState,
      });

      await tx.sourceStatus.upsert({
        where: { electionCode: result.electionCode },
        create: { electionCode: result.electionCode, feedVersion: 1 },
        update: { feedVersion: { increment: 1 } },
      });
    });
  }

  async touchScope(
    electionCode: string,
    scope: Scope,
    update: { seenAt: Date; generatedAt?: Date; etag?: string | null },
  ): Promise<void> {
    const data = {
      lastSeenAt: update.seenAt,
      notFoundUntil: null,
      ...(update.generatedAt !== undefined && { lastGeneratedAt: update.generatedAt }),
      ...(update.etag !== undefined && { lastEtag: update.etag }),
    };
    await this.prisma.scopeSourceState.upsert({
      where: { electionCode_scope: { electionCode, scope } },
      create: { electionCode, scope, ...data },
      update: data,
    });
  }

  async markNotFound(electionCode: string, scope: Scope, until: Date): Promise<void> {
    await this.prisma.scopeSourceState.upsert({
      where: { electionCode_scope: { electionCode, scope } },
      create: { electionCode, scope, notFoundUntil: until },
      update: { notFoundUntil: until },
    });
  }

  async markBlocked(electionCode: string, until: Date): Promise<void> {
    await this.prisma.sourceStatus.upsert({
      where: { electionCode },
      create: { electionCode, blockedUntil: until },
      update: { blockedUntil: until },
    });
  }

  async recordCycle(
    electionCode: string,
    cycle: { attemptAt: Date; success: boolean; error: string | null },
  ): Promise<void> {
    const data = {
      lastAttemptAt: cycle.attemptAt,
      lastError: cycle.error,
      ...(cycle.success && { lastSuccessAt: cycle.attemptAt }),
    };
    await this.prisma.sourceStatus.upsert({
      where: { electionCode },
      create: { electionCode, ...data },
      update: data,
    });
  }
}
