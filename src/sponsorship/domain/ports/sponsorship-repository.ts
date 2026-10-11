import type { ImageSignals } from '../../../moderation/domain/signals';
import type { ModerationState, ModerationWrites } from '../moderation-state';
import type { ReceivedPayment, RefundState } from '../payment';
import type { SponsorshipSlot } from '../slots';
import type { ElectionDay } from '../sponsorship-config';
import type { Sponsorship } from '../scheduling';

export type ConfirmOutcome =
  | { kind: 'not_found' }
  | { kind: 'expired'; refundRequested: boolean }
  | { kind: 'price_changed'; refundRequested: boolean }
  /** Origem simulada em pedido não aprovado: nada é gravado (sponsorship-image-moderation R-7). */
  | { kind: 'not_approved'; moderation: Exclude<ModerationState, 'approved'> }
  | { kind: 'scheduled'; sponsorship: Sponsorship };

/** Registro de auditoria de uma tentativa (sponsorship-image-moderation R-9). */
export interface ModerationRecordInput {
  attempt: number;
  provider: string;
  model: string | null;
  policyVersion: string;
  outcome: 'approved' | 'rejected' | 'error';
  modelDecision: 'APPROVE' | 'REJECT' | null;
  categories: string[];
  reasons: string[];
  detectedText: string[];
  confidence: number | null;
  rejectionRules: string[];
  errorCode: string | null;
  requestId: string | null;
  imageSha256: string | null;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Sinais normalizados do provedor (R-3, R-9); nulos em falha antes da análise. */
  signals: ImageSignals | null;
  createdAt: Date;
}

export interface ScheduleItem {
  id: string;
  slot: SponsorshipSlot;
  startsAt: Date;
  endsAt: Date;
  /** Link opcional do anúncio (sponsor-link R-2). */
  linkUrl: string | null;
}

export interface ExpiredOrder {
  id: string;
  imageKey: string | null;
  paymentGateway: string;
  chargeId: string;
}

/** Desfecho gravado com cada evento de webhook (asaas-payment FR-02, R-6). */
export type PaymentWebhookOutcome =
  'scheduled' | 'refund_requested' | 'refund_done' | 'ignored' | 'rejected';

export interface WebhookEventRecord {
  /** Id do evento no gateway — chave de idempotência. */
  id: string;
  gateway: string;
  event: string;
  chargeId: string | null;
  sponsorshipId: string | null;
  receivedAt: Date;
  payload: unknown;
}

export interface SponsorshipRepository {
  create(sponsorship: Sponsorship): Promise<void>;
  findById(id: string): Promise<Sponsorship | null>;
  /** Maior `endsAt` dos `scheduled` de cada local (null se nenhum). */
  queueEnds(): Promise<Partial<Record<SponsorshipSlot, Date>>>;
  /**
   * Confirma o pagamento numa transação com bloqueio por local (R-5, R-9): idempotente para
   * `scheduled`; vencido vira `expired`; senão calcula a janela com {@link schedule} do domínio e,
   * se a faixa de preço mudou ({@link confirmationTierMatches}), grava `expired` e devolve
   * `price_changed` sem agendar (sponsorship-election-pricing R-5). Com `received` (pagamento
   * real), grava o que {@link scheduleWrites}/{@link expiryWrites} decidem — inclusive o pedido de
   * estorno quando não dá para agendar (asaas-payment R-5).
   */
  confirm(
    id: string,
    now: Date,
    electionDay: ElectionDay,
    received?: ReceivedPayment,
  ): Promise<ConfirmOutcome>;
  /** `scheduled` com `endsAt > from` e `startsAt < to`, por `startsAt`. */
  scheduleWindow(from: Date, to: Date): Promise<ScheduleItem[]>;
  /** Marca `expired` (motivo `payment_timeout`) os pendentes vencidos e os devolve. */
  expirePending(now: Date): Promise<ExpiredOrder[]>;
  /** `scheduled` encerrados antes de `before` que ainda têm imagem. */
  endedWithImage(before: Date): Promise<{ id: string; imageKey: string }[]>;
  clearImage(id: string): Promise<void>;
  /**
   * Grava o evento e aplica `apply` na **mesma transação** (asaas-payment R-6). Evento já gravado
   * → `duplicate`, sem chamar `apply`. Se `apply` falhar, nada fica gravado.
   */
  recordWebhookEvent(
    event: WebhookEventRecord,
    apply: (repository: SponsorshipRepository) => Promise<PaymentWebhookOutcome>,
  ): Promise<PaymentWebhookOutcome | 'duplicate'>;
  /** Pedidos com `refund = requested`, dos mais antigos (`paidAt`) aos mais novos. */
  refundsRequested(limit: number): Promise<Sponsorship[]>;
  markRefund(
    id: string,
    data: { refund: RefundState; refundAttempts: number; refundedAt: Date | null },
  ): Promise<void>;
  /** Estorno confirmado pelo gateway (webhook): `refund = done`. Devolve o id do pedido ou null. */
  markRefundDoneByCharge(gateway: string, chargeId: string, now: Date): Promise<string | null>;
  /**
   * Reivindica **um** pedido para moderação (sponsorship-image-moderation R-5): `pending`,
   * `pending_payment` não vencido, `moderationNextAttemptAt ≤ now`, sem reivindicação vigente; o
   * mais antigo primeiro. Grava `moderationClaimedUntil = claimUntil` atomicamente.
   */
  claimForModeration(now: Date, claimUntil: Date): Promise<Sponsorship | null>;
  releaseModerationClaim(id: string): Promise<void>;
  /**
   * Grava o registro de auditoria e as escritas do pedido na **mesma transação** (R-9), com a
   * linha bloqueada. Se o pedido já não está `pending`/`pending_payment`, só o registro é gravado
   * → `order_changed`.
   */
  recordModeration(
    id: string,
    record: ModerationRecordInput,
    writes: ModerationWrites,
  ): Promise<'applied' | 'order_changed'>;
  /** Registros do provedor criados desde `since` (teto por hora, R-5). */
  moderationCallsSince(provider: string, since: Date): Promise<number>;
}

export const SPONSORSHIP_REPOSITORY = Symbol('SPONSORSHIP_REPOSITORY');
