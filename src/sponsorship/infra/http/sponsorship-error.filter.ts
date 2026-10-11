import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Response } from 'express';
import { SponsorshipError } from '../../domain/errors';

const STATUS: Record<string, number> = { unavailable: 503, not_found: 404, expired: 409 };

/**
 * Traduz erros do domínio para HTTP (spec sponsorships FR-03): validação → 400 `{ code }`,
 * `unavailable` → 503, `not_found` → 404, `expired` → 409. O limite de tamanho do multer vira
 * `400 image_too_large`.
 */
@Catch(SponsorshipError, PayloadTooLargeException)
export class SponsorshipErrorFilter implements ExceptionFilter {
  catch(error: SponsorshipError | PayloadTooLargeException, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const code = error instanceof SponsorshipError ? error.code : 'image_too_large';
    const status = STATUS[code] ?? 400;
    res.status(status).json({ code });
  }
}
