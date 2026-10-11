import type { SponsorshipSlot } from '../slots';
import type { Sponsorship } from '../scheduling';

export type ConfirmOutcome =
  { kind: 'not_found' } | { kind: 'expired' } | { kind: 'scheduled'; sponsorship: Sponsorship };

export interface ScheduleItem {
  id: string;
  slot: SponsorshipSlot;
  startsAt: Date;
  endsAt: Date;
}

export interface SponsorshipRepository {
  create(sponsorship: Sponsorship): Promise<void>;
  findById(id: string): Promise<Sponsorship | null>;
  /** Maior `endsAt` dos `scheduled` de cada local (null se nenhum). */
  queueEnds(): Promise<Partial<Record<SponsorshipSlot, Date>>>;
  /**
   * Confirma o pagamento numa transação com bloqueio por local (R-5, R-9): idempotente para
   * `scheduled`; vencido vira `expired`; senão agenda com {@link schedule} do domínio.
   */
  confirm(id: string, now: Date, leadSeconds: number): Promise<ConfirmOutcome>;
  /** `scheduled` com `endsAt > from` e `startsAt < to`, por `startsAt`. */
  scheduleWindow(from: Date, to: Date): Promise<ScheduleItem[]>;
  /** Marca `expired` os pendentes vencidos e devolve as chaves de imagem deles. */
  expirePending(now: Date): Promise<{ id: string; imageKey: string }[]>;
  /** `scheduled` encerrados antes de `before` que ainda têm imagem. */
  endedWithImage(before: Date): Promise<{ id: string; imageKey: string }[]>;
  clearImage(id: string): Promise<void>;
}

export const SPONSORSHIP_REPOSITORY = Symbol('SPONSORSHIP_REPOSITORY');
