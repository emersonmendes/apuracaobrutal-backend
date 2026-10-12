import { Prisma, type Sponsorship as SponsorshipRow } from '@prisma/client';
import { isModerationCategory } from '../../../moderation/domain/categories';
import type { PrismaService } from '../../../prisma/prisma.service';
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

const toDomain = (row: SponsorshipRow): Sponsorship => ({
  ...row,
  moderationCategories: row.moderationCategories.filter(isModerationCategory),
});

/**
 * Persistência dos pedidos de patrocínio no Postgres (spec sponsorships FR-02, R-9; asaas-payment
 * FR-02, R-5–R-7). Uma instância pode estar ligada a uma transação aberta (`tx`): é assim que o
 * evento de webhook e os seus efeitos ficam na mesma transação (R-6).
 */
export class PrismaSponsorshipRepository implements SponsorshipRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tx: Prisma.TransactionClient | null = null,
  ) {}

  private get db(): Prisma.TransactionClient {
    return this.tx ?? this.prisma;
  }

  /** Reusa a transação aberta, se houver; senão abre uma. */
  private transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.tx ? fn(this.tx) : this.prisma.$transaction(fn);
  }

  async create(sponsorship: Sponsorship): Promise<void> {
    await this.db.sponsorship.create({ data: sponsorship });
  }

  async findById(id: string): Promise<Sponsorship | null> {
    const row = await this.db.sponsorship.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async queueEnds(): Promise<Partial<Record<SponsorshipSlot, Date>>> {
    const groups = await this.db.sponsorship.groupBy({
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
   * senão serializa o local com um advisory lock de transação, lê o fim da fila e agenda (R-5) —
   * ou, se a faixa de preço mudou, expira sem agendar (sponsorship-election-pricing R-5). O que é
   * gravado em cada desfecho vem do domínio (`scheduleWrites`/`expiryWrites`, asaas-payment R-5).
   */
  async confirm(
    id: string,
    now: Date,
    electionDay: ElectionDay,
    received?: ReceivedPayment,
  ): Promise<ConfirmOutcome> {
    return this.transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM sponsorship WHERE id = ${id}::uuid FOR UPDATE`;
      if (locked.length === 0) return { kind: 'not_found' } as const;

      const row = await tx.sponsorship.findUniqueOrThrow({ where: { id } });
      if (row.status === 'scheduled') {
        return { kind: 'scheduled', sponsorship: toDomain(row) } as const;
      }
      // Prazo vencido tem precedência sobre moderação pendente (R-9; sponsorship-image-moderation R-7).
      if (expiredByDeadline(row, now)) {
        const writes = expiryWrites(row, 'payment_timeout', received, now);
        await tx.sponsorship.update({ where: { id }, data: writes });
        return { kind: 'expired', refundRequested: writes.refund !== 'none' } as const;
      }
      // Gate de moderação (sponsorship-image-moderation R-7): simulado → nada gravado; pagamento
      // real → expira com estorno.
      if (row.moderation !== 'approved') {
        if (!received) return { kind: 'not_approved', moderation: row.moderation } as const;
        const writes = expiryWrites(row, moderationExpiryReason(row), received, now);
        await tx.sponsorship.update({ where: { id }, data: writes });
        return { kind: 'expired', refundRequested: writes.refund !== 'none' } as const;
      }

      // A leitura abaixo precisa ver o `endsAt` que a confirmação anterior do mesmo local acabou
      // de gravar: isso vale no isolamento padrão (`READ COMMITTED`), em que cada consulta enxerga
      // o que foi comitado antes dela. Não configure `isolationLevel` nesta transação — com
      // `REPEATABLE READ`/`SERIALIZABLE` o snapshot seria anterior ao lock e dois patrocínios se
      // sobreporiam. O int-spec AC-07 (confirmações simultâneas) é a guarda.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sponsorship:${row.slot}`}))`;
      const queue = await tx.sponsorship.aggregate({
        where: { slot: row.slot, status: 'scheduled' },
        _max: { endsAt: true },
      });
      const window = schedule(now, row.minutes, queue._max.endsAt);
      if (!confirmationTierMatches(row, window, electionDay)) {
        const writes = expiryWrites(row, 'price_changed', received, now);
        await tx.sponsorship.update({ where: { id }, data: writes });
        return { kind: 'price_changed', refundRequested: writes.refund !== 'none' } as const;
      }
      const updated = await tx.sponsorship.update({
        where: { id },
        data: scheduleWrites(window, received, now),
      });
      return { kind: 'scheduled', sponsorship: toDomain(updated) } as const;
    });
  }

  async scheduleWindow(from: Date, to: Date): Promise<ScheduleItem[]> {
    const rows = await this.db.sponsorship.findMany({
      where: {
        status: 'scheduled',
        moderation: 'approved',
        imageKey: { not: null },
        endsAt: { gt: from },
        startsAt: { lt: to },
      },
      orderBy: { startsAt: 'asc' },
      select: { id: true, slot: true, startsAt: true, endsAt: true, linkUrl: true },
    });
    return rows.map((row) => ({
      id: row.id,
      slot: row.slot,
      linkUrl: row.linkUrl,
      startsAt: row.startsAt!,
      endsAt: row.endsAt!,
    }));
  }

  /**
   * Uma só instrução: `RETURNING` devolve apenas as linhas que esta atualização de fato expirou.
   * Um pedido confirmado no mesmo instante (linha travada por `confirm()`) é reavaliado após o
   * bloqueio e, já `scheduled`, fica de fora — a limpeza nunca apaga a imagem de um pago (FR-05).
   */
  async expirePending(now: Date): Promise<ExpiredOrder[]> {
    const rows = await this.db.$queryRaw<
      { id: string; image_key: string | null; payment_gateway: string; charge_id: string }[]
    >`
      UPDATE sponsorship
      SET status = 'expired', expiry_reason = 'payment_timeout'
      WHERE status = 'pending_payment' AND payment_expires_at <= ${now}
      RETURNING id, image_key, payment_gateway, charge_id`;
    return rows.map((row) => ({
      id: row.id,
      imageKey: row.image_key,
      paymentGateway: row.payment_gateway,
      chargeId: row.charge_id,
    }));
  }

  async endedWithImage(before: Date): Promise<{ id: string; imageKey: string }[]> {
    const rows = await this.db.sponsorship.findMany({
      where: { status: 'scheduled', endsAt: { lte: before }, imageKey: { not: null } },
      select: { id: true, imageKey: true },
    });
    return rows.map((row) => ({ id: row.id, imageKey: row.imageKey! }));
  }

  async clearImage(id: string): Promise<void> {
    await this.db.sponsorship.update({ where: { id }, data: { imageKey: null } });
  }

  /**
   * Evento + efeito na mesma transação (asaas-payment R-6). O `id` do evento é chave primária:
   * repetido → `duplicate` sem reaplicar; dois envios simultâneos do mesmo evento → o segundo
   * falha na chave e também vira `duplicate` (a transação dele é desfeita).
   */
  async recordWebhookEvent(
    event: WebhookEventRecord,
    apply: (repository: SponsorshipRepository) => Promise<PaymentWebhookOutcome>,
  ): Promise<PaymentWebhookOutcome | 'duplicate'> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.paymentWebhookEvent.findUnique({
          where: { id: event.id },
          select: { id: true },
        });
        if (existing) return 'duplicate' as const;
        const outcome = await apply(new PrismaSponsorshipRepository(this.prisma, tx));
        await tx.paymentWebhookEvent.create({
          data: {
            id: event.id,
            gateway: event.gateway,
            event: event.event,
            chargeId: event.chargeId,
            sponsorshipId: event.sponsorshipId,
            receivedAt: event.receivedAt,
            outcome,
            payload: (event.payload ?? null) as Prisma.InputJsonValue,
          },
        });
        return outcome;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return 'duplicate';
      }
      throw error;
    }
  }

  async refundsRequested(limit: number): Promise<Sponsorship[]> {
    const rows = await this.db.sponsorship.findMany({
      where: { refund: 'requested' },
      orderBy: { paidAt: 'asc' },
      take: limit,
    });
    return rows.map(toDomain);
  }

  async markRefund(
    id: string,
    data: { refund: RefundState; refundAttempts: number; refundedAt: Date | null },
  ): Promise<void> {
    await this.db.sponsorship.update({ where: { id }, data });
  }

  async markRefundDoneByCharge(
    gateway: string,
    chargeId: string,
    now: Date,
  ): Promise<string | null> {
    const row = await this.db.sponsorship.findUnique({
      where: { paymentGateway_chargeId: { paymentGateway: gateway, chargeId } },
      select: { id: true, refund: true, refundedAt: true },
    });
    if (!row) return null;
    if (row.refund !== 'done') {
      await this.db.sponsorship.update({
        where: { id: row.id },
        data: { refund: 'done', refundedAt: row.refundedAt ?? now },
      });
    }
    return row.id;
  }

  /** `FOR UPDATE SKIP LOCKED`: dois workers nunca reivindicam o mesmo pedido (R-5). */
  async claimForModeration(now: Date, claimUntil: Date): Promise<Sponsorship | null> {
    return this.transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM sponsorship
        WHERE moderation = 'pending'
          AND status = 'pending_payment'
          AND payment_expires_at > ${now}
          AND moderation_next_attempt_at <= ${now}
          AND (moderation_claimed_until IS NULL OR moderation_claimed_until <= ${now})
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED`;
      if (rows.length === 0) return null;
      const updated = await tx.sponsorship.update({
        where: { id: rows[0].id },
        data: { moderationClaimedUntil: claimUntil },
      });
      return toDomain(updated);
    });
  }

  async releaseModerationClaim(id: string): Promise<void> {
    await this.db.sponsorship.update({ where: { id }, data: { moderationClaimedUntil: null } });
  }

  /** Registro + escritas numa transação com a linha bloqueada (R-9); serializa com `confirm`. */
  async recordModeration(
    id: string,
    record: ModerationRecordInput,
    writes: ModerationWrites,
  ): Promise<'applied' | 'order_changed'> {
    return this.transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM sponsorship WHERE id = ${id}::uuid FOR UPDATE`;
      if (locked.length === 0) return 'order_changed' as const;
      const row = await tx.sponsorship.findUniqueOrThrow({ where: { id } });
      const { signals, ...fields } = record;
      await tx.sponsorshipModerationRecord.create({
        data: {
          sponsorshipId: id,
          ...fields,
          // JSON do Prisma: `null` em JS vira `DbNull` (coluna nula), não o JSON `null`.
          signals: signals === null ? Prisma.DbNull : (signals as unknown as Prisma.InputJsonValue),
        },
      });
      if (row.moderation !== 'pending' || row.status !== 'pending_payment') {
        return 'order_changed' as const;
      }
      await tx.sponsorship.update({ where: { id }, data: writes });
      return 'applied' as const;
    });
  }

  async moderationCallsSince(provider: string, since: Date): Promise<number> {
    return this.db.sponsorshipModerationRecord.count({
      where: { provider, createdAt: { gte: since } },
    });
  }
}
