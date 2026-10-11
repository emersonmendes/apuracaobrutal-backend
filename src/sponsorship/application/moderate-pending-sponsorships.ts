import type { ModerateImage } from '../../moderation/application/moderate-image';
import { sha256Hex } from '../domain/image-rules';
import {
  applyModerationResult,
  isFinalRejection,
  type ModerationAttemptOutcome,
} from '../domain/moderation-state';
import type { CandidateIdentity } from '../domain/ports/candidate-identity';
import type { Clock } from '../domain/ports/clock';
import type { PaymentGateway } from '../domain/ports/payment-gateway';
import type { SponsorImageStorage } from '../domain/ports/sponsor-image-storage';
import type {
  ModerationRecordInput,
  SponsorshipRepository,
} from '../domain/ports/sponsorship-repository';
import type { SponsorshipConfig } from '../domain/sponsorship-config';

const HOUR_MS = 60 * 60_000;

interface Logger {
  log(message: string): void;
  warn(message: string): void;
}

/** Parâmetros do analisador repassados ao caso de uso (sponsorship-image-moderation FR-01, R-4). */
export interface ModerationRuntime {
  timeoutMs: number;
  labelMinConfidence: number;
  celebrityMinConfidence: number;
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
    private readonly identity: CandidateIdentity,
    private readonly gateway: PaymentGateway,
    private readonly clock: Clock,
    private readonly config: SponsorshipConfig,
    private readonly runtime: ModerationRuntime,
    private readonly logger: Logger,
  ) {}

  async execute(): Promise<ModerationRunResult> {
    const now = this.clock.now();
    const order = await this.repository.claimForModeration(
      now,
      new Date(now.getTime() + 2 * this.runtime.timeoutMs),
    );
    if (!order) return { processed: 0 };

    const provider = this.moderate.providerName;
    const { maxPerHour, maxAttempts } = this.config.moderation;
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
      signals: null,
      createdAt: now,
    };
    let result: ModerationAttemptOutcome;
    let counts = 'labels=- lines=- faces=-';

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
        { image: bytes, mediaType: 'image/webp' },
        {
          labelMinConfidence: this.runtime.labelMinConfidence,
          celebrityMinConfidence: this.runtime.celebrityMinConfidence,
          candidates: await this.identity.candidates(),
        },
      );
      Object.assign(record, {
        model: attemptResult.model,
        policyVersion: attemptResult.policyVersion,
        requestId: attemptResult.requestId,
        latencyMs: attemptResult.latencyMs,
      });
      if (attemptResult.outcome === 'error') {
        result = { outcome: 'error', errorCode: attemptResult.errorCode };
        record.errorCode = attemptResult.errorCode;
      } else {
        const { verdict, signals } = attemptResult;
        result =
          verdict.outcome === 'approved'
            ? { outcome: 'approved' }
            : { outcome: 'rejected', categories: verdict.categories };
        Object.assign(record, {
          outcome: verdict.outcome,
          categories: verdict.categories,
          reasons: verdict.reasons,
          detectedText: signals.textLines.map((line) => line.text),
          confidence: verdict.confidence,
          rejectionRules: verdict.rules,
          signals,
        });
        counts = `labels=${signals.labels.length} lines=${signals.textLines.length} faces=${signals.celebrities.length}`;
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
    // Sem texto detectado, nomes, motivos, imagem ou dados pessoais no log (R-8).
    this.logger.log(
      `moderação ${order.id} tentativa ${attempt}: ${outcome}` +
        ` categorias=[${record.categories.join(',')}] regras=[${record.rejectionRules.join(',')}]` +
        ` erro=${record.errorCode ?? '-'} latência=${record.latencyMs}ms ${counts}` +
        ` req=${record.requestId ?? '-'}`,
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
