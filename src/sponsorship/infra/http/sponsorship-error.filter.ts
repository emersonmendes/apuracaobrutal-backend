import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  Logger,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Response } from 'express';
import { GatewayError, SponsorshipError, StorageError } from '../../domain/errors';

const STATUS: Record<string, number> = {
  unavailable: 503,
  sales_closed: 409,
  not_found: 404,
  expired: 409,
  price_changed: 409,
  already_paid: 409,
  gateway_error: 502,
  storage_error: 503,
  moderation_pending: 409,
  moderation_rejected: 409,
  moderation_error: 409,
};

/**
 * Traduz erros do domínio para HTTP (spec sponsorships FR-03; asaas-payment FR-03): validação →
 * 400 `{ code }` (inclusive `exceeds_sales_end`, sponsorship-sales-cutoff FR-03), `unavailable` →
 * 503, `not_found` → 404, `expired`/`price_changed`/`already_paid`/`sales_closed` → 409, `moderation_*` (pedido não aprovado na moderação; sponsorship-image-moderation R-7) →
 * 409, falha do gateway → 502, falha do armazenamento de imagens → 503 (sponsorship-s3-storage
 * FR-04). O limite de tamanho do multer vira `400 image_too_large`.
 */
@Catch(SponsorshipError, GatewayError, StorageError, PayloadTooLargeException)
export class SponsorshipErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(SponsorshipErrorFilter.name);

  catch(
    error: SponsorshipError | GatewayError | StorageError | PayloadTooLargeException,
    host: ArgumentsHost,
  ) {
    const res = host.switchToHttp().getResponse<Response>();
    const code = error instanceof PayloadTooLargeException ? 'image_too_large' : error.code;
    // As mensagens de GatewayError/StorageError não carregam credenciais nem dados pessoais
    // (asaas-payment R-3; sponsorship-s3-storage R-4).
    if (error instanceof GatewayError || error instanceof StorageError) {
      this.logger.warn(error.message);
    }
    const status = STATUS[code] ?? 400;
    res.status(status).json({ code });
  }
}
