import type { ModerateImage } from '../../moderation/application/moderate-image';
import { sha256Hex } from '../domain/image-rules';
import {
  applyModerationResult,
  isFinalRejection,
  type ModerationAttemptOutcome,
} from '../domain/moderation-state';
import type { CandidateNames } from '../domain/ports/candidate-names';
import type { Clock } from '../domain/ports/clock';
import type { PaymentGateway } from '../domain/ports/payment-gateway';
import type { SponsorImageStorage } from '../domain/ports/sponsor-image-storage';
import type {
  ModerationRecordInput,
  SponsorshipRepository,
} from '../domain/ports/sponsorship-repository';
import { slotPlacement } from '../domain/slots';
import type { SponsorshipConfig } from '../domain/sponsorship-config';

const HOUR_MS = 60 * 60_000;

interface Logger {
  log(message: string): void;
  warn(message: string): void;
}

export interface ModerationRunResult {
  processed: 0 | 1;
  outcome?: 'approved' | 'rejected' | 'retry' | 'error' | 'order_changed';
  skipped?: 'hourly_cap';
}

/**
 * Modera **um** pedido pendente por execução (spec sponsorship-image-moderation FR-05, Fluxo 3):
 * reivindica, confere o teto por hora e o hash da imagem (R-5, R-6), chama `ModerateImage`, grava
 * registro + estado na mesma transação (R-9) e, em recusa/erro definitivo, solta a imagem e cancela
 * a cobrança depois da transação (R-2). Estado inteiro no Postgres.
 */
export class ModeratePendingSponsorships {
  constructor(
    private readonly repository: SponsorshipRepository,
    private readonly storage: SponsorImageStorage,
    private readonly moderate: ModerateImage,
    private readonly names: CandidateNames,
    private readonly gateway: PaymentGateway,
    private readonly clock: Clock,
    private readonly config: SponsorshipConfig,
    private readonly timeoutMs: number,
    private readonly logger: Logger,
  ) {}

  async execute(): Promise<ModerationRunResult> {
    const now = this.clock.now();
    const order = await this.repository.claimForModeration(
      now,
      new Date(now.getTime() + 2 * this.timeoutMs),
    );
    if (!order) return { processed: 0 };

    const provider = this.moderate.providerName;
    const { maxPerHour, maxAttempts, minConfidence } = this.config.moderation;
    const calls = await this.repository.moderationCallsSince(
      provider,
      new Date(now.getTime() - HOUR_MS),
    );
    if (calls >= maxPerHour) {
      await this.repository.releaseModerationClaim(order.id);
      this.logger.warn(
        `teto de ${maxPerHour} análises por hora atingido; pedido ${order.id} continua pendente`,
      );
      return { processed: 0, skipped: 'hourly_cap' };
    }

    const attempt = order.moderationAttempts + 1;
    const startedAt = Date.now();
    const record: ModerationRecordInput = {
      attempt,
      provider,
      model: null,
      policyVersion: '',
      outcome: 'error',
      modelDecision: null,
      categories: [],
      reasons: [],
      detectedText: [],
      confidence: null,
      rejectionRules: [],
      errorCode: null,
      requestId: null,
      imageSha256: order.imageSha256,
      latencyMs: 0,
      inputTokens: null,
      outputTokens: null,
      createdAt: now,
    };
    let result: ModerationAttemptOutcome;

    const bytes = order.imageKey ? await this.storage.read(order.imageKey) : null;
    if (!bytes) {
      result = { outcome: 'error', errorCode: 'image_missing' };
      record.errorCode = 'image_missing';
    } else if (order.imageSha256 === null || sha256Hex(bytes) !== order.imageSha256) {
      // Arquivo ≠ imagem registrada: recusa terminal sem chamar a API (R-6).
      result = { outcome: 'rejected', categories: [] };
      record.outcome = 'rejected';
      record.errorCode = 'image_mismatch';
      record.imageSha256 = sha256Hex(bytes);
    } else {
      const attemptResult = await this.moderate.execute(
        { image: bytes, mediaType: 'image/webp', placement: slotPlacement(order.slot) },
        { minConfidence, ballotNames: await this.names.ballotNames() },
      );
      Object.assign(record, {
        model: attemptResult.model,
        policyVersion: attemptResult.policyVersion,
        requestId: attemptResult.requestId,
        latencyMs: attemptResult.latencyMs,
        inputTokens: attemptResult.inputTokens,
        outputTokens: attemptResult.outputTokens,
      });
      if (attemptResult.outcome === 'error') {
        result = { outcome: 'error', errorCode: attemptResult.errorCode };
        record.errorCode = attemptResult.errorCode;
      } else {
        const { verdict, response } = attemptResult;
        result =
          verdict.outcome === 'approved'
            ? { outcome: 'approved' }
            : { outcome: 'rejected', categories: verdict.categories };
        Object.assign(record, {
          outcome: verdict.outcome,
          modelDecision: verdict.modelDecision,
          categories: verdict.categories,
          reasons: response?.reasons ?? [],
          detectedText: response?.detectedText ?? [],
          confidence: verdict.confidence,
          rejectionRules: verdict.rules,
        });
      }
    }
    if (record.latencyMs === 0) record.latencyMs = Date.now() - startedAt;

    const writes = applyModerationResult(order, result, this.clock.now(), maxAttempts);
    const applied = await this.repository.recordModeration(order.id, record, writes);
    const outcome: ModerationRunResult['outcome'] =
      applied === 'order_changed'
        ? 'order_changed'
        : writes.moderation === 'pending'
          ? 'retry'
          : writes.moderation;
    // Sem texto detectado, motivos, imagem ou dados pessoais no log (R-8).
    this.logger.log(
      `moderação ${order.id} tentativa ${attempt}: ${outcome}` +
        ` categorias=[${record.categories.join(',')}] regras=[${record.rejectionRules.join(',')}]` +
        ` erro=${record.errorCode ?? '-'} latência=${record.latencyMs}ms` +
        ` tokens=${record.inputTokens ?? '-'}/${record.outputTokens ?? '-'} req=${record.requestId ?? '-'}`,
    );

    if (applied === 'applied' && isFinalRejection(writes)) await this.cleanup(order);
    return { processed: 1, outcome };
  }

  /** Depois da transação, melhor esforço (R-2): a limpeza do worker cobre o que sobrar. */
  private async cleanup(order: {
    id: string;
    imageKey: string | null;
    paymentGateway: string;
    chargeId: string;
  }) {
    if (order.imageKey) {
      try {
        await this.storage.remove(order.imageKey);
      } catch (error) {
        this.logger.warn(`falha ao remover a imagem do pedido ${order.id}: ${String(error)}`);
      }
    }
    if (order.paymentGateway === 'asaas' && this.gateway.name === 'asaas') {
      try {
        await this.gateway.cancelCharge(order.chargeId);
      } catch (error) {
        this.logger.warn(`falha ao cancelar a cobrança do pedido ${order.id}: ${String(error)}`);
      }
    }
  }
}
