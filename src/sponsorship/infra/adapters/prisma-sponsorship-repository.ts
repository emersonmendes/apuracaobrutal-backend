import type { Prisma, Sponsorship as SponsorshipRow } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import { paymentExpired, schedule, type Sponsorship } from '../../domain/scheduling';
import type { SponsorshipSlot } from '../../domain/slots';
import type {
  ConfirmOutcome,
  ScheduleItem,
  SponsorshipRepository,
} from '../../domain/ports/sponsorship-repository';

const toDomain = (row: SponsorshipRow): Sponsorship => ({ ...row });

/** Persistência dos pedidos de patrocínio no Postgres (spec sponsorships FR-02, R-9). */
export class PrismaSponsorshipRepository implements SponsorshipRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(sponsorship: Sponsorship): Promise<void> {
    await this.prisma.sponsorship.create({ data: sponsorship });
  }

  async findById(id: string): Promise<Sponsorship | null> {
    const row = await this.prisma.sponsorship.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async queueEnds(): Promise<Partial<Record<SponsorshipSlot, Date>>> {
    const groups = await this.prisma.sponsorship.groupBy({
      by: ['slot'],
      where: { status: 'scheduled' },
      _max: { endsAt: true },
    });
    const ends: Partial<Record<SponsorshipSlot, Date>> = {};
    for (const group of groups) if (group._max.endsAt) ends[group.slot] = group._max.endsAt;
    return ends;
  }

  /**
   * Uma transação (R-9): trava o pedido; idempotente se já `scheduled`; vencido vira `expired`;
   * senão serializa o local com um advisory lock de transação, lê o fim da fila e agenda (R-5).
   */
  async confirm(id: string, now: Date, leadSeconds: number): Promise<ConfirmOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM sponsorship WHERE id = ${id}::uuid FOR UPDATE`;
      if (locked.length === 0) return { kind: 'not_found' } as const;

      const row = await tx.sponsorship.findUniqueOrThrow({ where: { id } });
      if (row.status === 'scheduled') {
        return { kind: 'scheduled', sponsorship: toDomain(row) } as const;
      }
      if (row.status === 'expired' || paymentExpired(row, now)) {
        await tx.sponsorship.update({ where: { id }, data: { status: 'expired' } });
        return { kind: 'expired' } as const;
      }

      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sponsorship:${row.slot}`}))`;
      const queue = await tx.sponsorship.aggregate({
        where: { slot: row.slot, status: 'scheduled' },
        _max: { endsAt: true },
      });
      const window = schedule(now, row.minutes, queue._max.endsAt, leadSeconds);
      const updated = await tx.sponsorship.update({
        where: { id },
        data: { status: 'scheduled', confirmedAt: now, ...window },
      });
      return { kind: 'scheduled', sponsorship: toDomain(updated) } as const;
    });
  }

  async scheduleWindow(from: Date, to: Date): Promise<ScheduleItem[]> {
    const rows = await this.prisma.sponsorship.findMany({
      where: { status: 'scheduled', endsAt: { gt: from }, startsAt: { lt: to } },
      orderBy: { startsAt: 'asc' },
      select: { id: true, slot: true, startsAt: true, endsAt: true },
    });
    return rows.map((row) => ({
      id: row.id,
      slot: row.slot,
      startsAt: row.startsAt!,
      endsAt: row.endsAt!,
    }));
  }

  async expirePending(now: Date): Promise<{ id: string; imageKey: string }[]> {
    const where: Prisma.SponsorshipWhereInput = {
      status: 'pending_payment',
      paymentExpiresAt: { lte: now },
    };
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.sponsorship.findMany({ where, select: { id: true, imageKey: true } });
      await tx.sponsorship.updateMany({
        where: { ...where, id: { in: rows.map((row) => row.id) } },
        data: { status: 'expired' },
      });
      return rows.flatMap((row) => (row.imageKey ? [{ id: row.id, imageKey: row.imageKey }] : []));
    });
  }

  async endedWithImage(before: Date): Promise<{ id: string; imageKey: string }[]> {
    const rows = await this.prisma.sponsorship.findMany({
      where: { status: 'scheduled', endsAt: { lte: before }, imageKey: { not: null } },
      select: { id: true, imageKey: true },
    });
    return rows.map((row) => ({ id: row.id, imageKey: row.imageKey! }));
  }

  async clearImage(id: string): Promise<void> {
    await this.prisma.sponsorship.update({ where: { id }, data: { imageKey: null } });
  }
}
