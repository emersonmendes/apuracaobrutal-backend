import { paymentExpired, schedule, type Sponsorship } from '../../domain/scheduling';
import type { SponsorshipSlot } from '../../domain/slots';
import type {
  ConfirmOutcome,
  ScheduleItem,
  SponsorshipRepository,
} from '../../domain/ports/sponsorship-repository';

/** Repositório em memória com a mesma semântica do Prisma (testes e e2e). */
export class InMemorySponsorshipRepository implements SponsorshipRepository {
  readonly rows = new Map<string, Sponsorship>();
  failOnCreate = false;

  async create(sponsorship: Sponsorship): Promise<void> {
    if (this.failOnCreate) throw new Error('falha ao gravar');
    this.rows.set(sponsorship.id, { ...sponsorship });
  }

  async findById(id: string): Promise<Sponsorship | null> {
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }

  async queueEnds(): Promise<Partial<Record<SponsorshipSlot, Date>>> {
    const ends: Partial<Record<SponsorshipSlot, Date>> = {};
    for (const row of this.scheduled()) {
      const current = ends[row.slot];
      if (!current || row.endsAt!.getTime() > current.getTime()) ends[row.slot] = row.endsAt!;
    }
    return ends;
  }

  async confirm(id: string, now: Date, leadSeconds: number): Promise<ConfirmOutcome> {
    const row = this.rows.get(id);
    if (!row) return { kind: 'not_found' };
    if (row.status === 'scheduled') return { kind: 'scheduled', sponsorship: { ...row } };
    if (row.status === 'expired' || paymentExpired(row, now)) {
      row.status = 'expired';
      return { kind: 'expired' };
    }
    const queueEnd = (await this.queueEnds())[row.slot] ?? null;
    const window = schedule(now, row.minutes, queueEnd, leadSeconds);
    Object.assign(row, { status: 'scheduled', confirmedAt: now, ...window });
    return { kind: 'scheduled', sponsorship: { ...row } };
  }

  async scheduleWindow(from: Date, to: Date): Promise<ScheduleItem[]> {
    return this.scheduled()
      .filter(
        (row) => row.endsAt!.getTime() > from.getTime() && row.startsAt!.getTime() < to.getTime(),
      )
      .sort((a, b) => a.startsAt!.getTime() - b.startsAt!.getTime())
      .map((row) => ({ id: row.id, slot: row.slot, startsAt: row.startsAt!, endsAt: row.endsAt! }));
  }

  async expirePending(now: Date): Promise<{ id: string; imageKey: string }[]> {
    const expired: { id: string; imageKey: string }[] = [];
    for (const row of this.rows.values()) {
      if (row.status === 'pending_payment' && paymentExpired(row, now)) {
        row.status = 'expired';
        if (row.imageKey) expired.push({ id: row.id, imageKey: row.imageKey });
      }
    }
    return expired;
  }

  async endedWithImage(before: Date): Promise<{ id: string; imageKey: string }[]> {
    return this.scheduled()
      .filter((row) => row.imageKey && row.endsAt!.getTime() <= before.getTime())
      .map((row) => ({ id: row.id, imageKey: row.imageKey! }));
  }

  async clearImage(id: string): Promise<void> {
    const row = this.rows.get(id);
    if (row) row.imageKey = null;
  }

  private scheduled() {
    return [...this.rows.values()].filter((row) => row.status === 'scheduled');
  }
}
