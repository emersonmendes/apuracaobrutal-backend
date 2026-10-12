import { moderationExpiryReason, type ModerationWrites } from '../../domain/moderation-state';
import {
  expiryWrites,
  scheduleWrites,
  type ReceivedPayment,
  type RefundState,
} from '../../domain/payment';
import {
  confirmationTierMatches,
  expiredByDeadline,
  paymentExpired,
  schedule,
  type Sponsorship,
} from '../../domain/scheduling';
import type { ElectionDay } from '../../domain/sponsorship-config';
import type { SponsorshipSlot } from '../../domain/slots';
import type {
  ConfirmOutcome,
  ExpiredOrder,
  ModerationRecordInput,
  PaymentWebhookOutcome,
  ScheduleItem,
  SponsorshipRepository,
  WebhookEventRecord,
} from '../../domain/ports/sponsorship-repository';

/** Repositório em memória com a mesma semântica do Prisma (testes e e2e). */
export class InMemorySponsorshipRepository implements SponsorshipRepository {
  readonly rows = new Map<string, Sponsorship>();
  readonly events = new Map<string, WebhookEventRecord & { outcome: PaymentWebhookOutcome }>();
  readonly moderationRecords: (ModerationRecordInput & { sponsorshipId: string })[] = [];
  failOnCreate = false;
  /** Testes do fluxo de pagamento: simula o worker já ter aprovado a imagem ao criar. */
  autoApprove = false;

  async create(sponsorship: Sponsorship): Promise<void> {
    if (this.failOnCreate) throw new Error('falha ao gravar');
    const row = { ...sponsorship };
    if (this.autoApprove) this.approveRow(row);
    this.rows.set(sponsorship.id, row);
  }

  /** Marca a imagem como aprovada pela moderação (atalho de teste; o worker faz isso de verdade). */
  approve(id: string): void {
    const row = this.rows.get(id);
    if (row) this.approveRow(row);
  }

  private approveRow(row: Sponsorship) {
    row.moderation = 'approved';
    row.moderatedAt = row.createdAt;
    row.moderationAttempts = 1;
    row.moderationNextAttemptAt = null;
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

  async confirm(
    id: string,
    now: Date,
    electionDay: ElectionDay,
    received?: ReceivedPayment,
  ): Promise<ConfirmOutcome> {
    const row = this.rows.get(id);
    if (!row) return { kind: 'not_found' };
    if (row.status === 'scheduled') return { kind: 'scheduled', sponsorship: { ...row } };
    if (expiredByDeadline(row, now)) {
      const writes = expiryWrites(row, 'payment_timeout', received, now);
      Object.assign(row, writes);
      return { kind: 'expired', refundRequested: writes.refund !== 'none' };
    }
    if (row.moderation !== 'approved') {
      if (!received) return { kind: 'not_approved', moderation: row.moderation };
      const writes = expiryWrites(row, moderationExpiryReason(row), received, now);
      Object.assign(row, writes);
      return { kind: 'expired', refundRequested: writes.refund !== 'none' };
    }
    const queueEnd = (await this.queueEnds())[row.slot] ?? null;
    const window = schedule(now, row.minutes, queueEnd);
    if (!confirmationTierMatches(row, window, electionDay)) {
      const writes = expiryWrites(row, 'price_changed', received, now);
      Object.assign(row, writes);
      return { kind: 'price_changed', refundRequested: writes.refund !== 'none' };
    }
    Object.assign(row, scheduleWrites(window, received, now));
    return { kind: 'scheduled', sponsorship: { ...row } };
  }

  async scheduleWindow(from: Date, to: Date): Promise<ScheduleItem[]> {
    return this.scheduled()
      .filter(
        (row) =>
          row.moderation === 'approved' &&
          row.imageKey !== null &&
          row.endsAt!.getTime() > from.getTime() &&
          row.startsAt!.getTime() < to.getTime(),
      )
      .sort((a, b) => a.startsAt!.getTime() - b.startsAt!.getTime())
      .map((row) => ({
        id: row.id,
        slot: row.slot,
        startsAt: row.startsAt!,
        endsAt: row.endsAt!,
        linkUrl: row.linkUrl,
      }));
  }

  async expirePending(now: Date): Promise<ExpiredOrder[]> {
    const expired: ExpiredOrder[] = [];
    for (const row of this.rows.values()) {
      if (row.status === 'pending_payment' && paymentExpired(row, now)) {
        row.status = 'expired';
        row.expiryReason = 'payment_timeout';
        expired.push({
          id: row.id,
          imageKey: row.imageKey,
          paymentGateway: row.paymentGateway,
          chargeId: row.chargeId,
        });
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

  async recordWebhookEvent(
    event: WebhookEventRecord,
    apply: (repository: SponsorshipRepository) => Promise<PaymentWebhookOutcome>,
  ): Promise<PaymentWebhookOutcome | 'duplicate'> {
    if (this.events.has(event.id)) return 'duplicate';
    const outcome = await apply(this);
    this.events.set(event.id, { ...event, outcome });
    return outcome;
  }

  async refundsRequested(limit: number): Promise<Sponsorship[]> {
    return [...this.rows.values()]
      .filter((row) => row.refund === 'requested')
      .sort((a, b) => (a.paidAt?.getTime() ?? 0) - (b.paidAt?.getTime() ?? 0))
      .slice(0, limit)
      .map((row) => ({ ...row }));
  }

  async markRefund(
    id: string,
    data: { refund: RefundState; refundAttempts: number; refundedAt: Date | null },
  ): Promise<void> {
    const row = this.rows.get(id);
    if (row) Object.assign(row, data);
  }

  async markRefundDoneByCharge(
    gateway: string,
    chargeId: string,
    now: Date,
  ): Promise<string | null> {
    const row = [...this.rows.values()].find(
      (candidate) => candidate.paymentGateway === gateway && candidate.chargeId === chargeId,
    );
    if (!row) return null;
    if (row.refund !== 'done') {
      row.refund = 'done';
      row.refundedAt = row.refundedAt ?? now;
    }
    return row.id;
  }

  async claimForModeration(now: Date, claimUntil: Date): Promise<Sponsorship | null> {
    const row = [...this.rows.values()]
      .filter(
        (candidate) =>
          candidate.moderation === 'pending' &&
          candidate.status === 'pending_payment' &&
          !paymentExpired(candidate, now) &&
          candidate.moderationNextAttemptAt !== null &&
          candidate.moderationNextAttemptAt.getTime() <= now.getTime() &&
          (candidate.moderationClaimedUntil === null ||
            candidate.moderationClaimedUntil.getTime() <= now.getTime()),
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
    if (!row) return null;
    row.moderationClaimedUntil = claimUntil;
    return { ...row };
  }

  async releaseModerationClaim(id: string): Promise<void> {
    const row = this.rows.get(id);
    if (row) row.moderationClaimedUntil = null;
  }

  async recordModeration(
    id: string,
    record: ModerationRecordInput,
    writes: ModerationWrites,
  ): Promise<'applied' | 'order_changed'> {
    const row = this.rows.get(id);
    if (!row) return 'order_changed';
    if (
      this.moderationRecords.some((r) => r.sponsorshipId === id && r.attempt === record.attempt)
    ) {
      throw new Error(`registro repetido para ${id}/${record.attempt}`);
    }
    this.moderationRecords.push({ sponsorshipId: id, ...record });
    if (row.moderation !== 'pending' || row.status !== 'pending_payment') return 'order_changed';
    Object.assign(row, writes);
    return 'applied';
  }

  async moderationCallsSince(provider: string, since: Date): Promise<number> {
    return this.moderationRecords.filter(
      (r) => r.provider === provider && r.createdAt.getTime() >= since.getTime(),
    ).length;
  }

  private scheduled() {
    return [...this.rows.values()].filter((row) => row.status === 'scheduled');
  }
}
