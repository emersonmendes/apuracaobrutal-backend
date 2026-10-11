import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  Logger,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Response } from 'express';
import { GatewayError, SponsorshipError } from '../../domain/errors';

const STATUS: Record<string, number> = {
  unavailable: 503,
  not_found: 404,
  expired: 409,
  price_changed: 409,
  already_paid: 409,
  gateway_error: 502,
  moderation_pending: 409,
  moderation_rejected: 409,
  moderation_error: 409,
};

/**
 * Traduz erros do domínio para HTTP (spec sponsorships FR-03; asaas-payment FR-03): validação →
 * 400 `{ code }`, `unavailable` → 503, `not_found` → 404, `expired`/`price_changed`/`already_paid`
 * → 409, `moderation_*` (pedido não aprovado na moderação; sponsorship-image-moderation R-7) →
 * 409, falha do gateway → 502. O limite de tamanho do multer vira `400 image_too_large`.
 */
@Catch(SponsorshipError, GatewayError, PayloadTooLargeException)
export class SponsorshipErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(SponsorshipErrorFilter.name);

  catch(error: SponsorshipError | GatewayError | PayloadTooLargeException, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const code =
      error instanceof SponsorshipError || error instanceof GatewayError
        ? error.code
        : 'image_too_large';
    // A mensagem do GatewayError não carrega chave nem dados do pagador (asaas-payment R-3).
    if (error instanceof GatewayError) this.logger.warn(error.message);
    const status = STATUS[code] ?? 400;
    res.status(status).json({ code });
  }
}
