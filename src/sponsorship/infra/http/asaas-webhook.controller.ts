import { Body, Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBody, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { HandleAsaasWebhook } from '../../application/handle-asaas-webhook';
import type { SponsorshipConfig } from '../../domain/sponsorship-config';
import { SPONSORSHIP_CONFIG } from '../config/sponsorship-config.factory';
import { AsaasWebhookBodyDto, WebhookAckDto, WebhookErrorDto } from './dto/sponsorship.dto';
import { Inject } from '@nestjs/common';
import { WebhookRejected } from './webhook-rejected';

/** Corpo máximo aceito (spec asaas-payment R-6). */
export const WEBHOOK_MAX_BYTES = 64 * 1024;

/** Comparação em tempo constante; comprimentos diferentes → falso. */
export function tokenMatches(received: string | undefined, expected: string): boolean {
  if (typeof received !== 'string') return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Webhook do Asaas (spec asaas-payment R-6, FR-03). Controller fino: autentica pelo header,
 * valida a forma mínima do corpo e delega. Nunca loga o corpo; sem limite por IP e sem CORS.
 */
@ApiTags('payments')
@Controller('webhooks')
export class AsaasWebhookController {
  constructor(
    private readonly handle: HandleAsaasWebhook,
    @Inject(SPONSORSHIP_CONFIG) private readonly config: SponsorshipConfig,
  ) {}

  @Post('asaas')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Recebe eventos de cobrança do Asaas',
    description:
      'Autenticado pelo header `asaas-access-token` (token do webhook). Idempotente pelo `id` ' +
      'do evento; PAYMENT_CONFIRMED/PAYMENT_RECEIVED agendam o patrocínio ou pedem estorno; ' +
      'PAYMENT_REFUNDED conclui o estorno; outros eventos são só registrados.',
  })
  @ApiHeader({ name: 'asaas-access-token', required: true })
  @ApiBody({ type: AsaasWebhookBodyDto })
  @ApiResponse({ status: 200, type: WebhookAckDto })
  @ApiResponse({ status: 400, type: WebhookErrorDto, description: 'Corpo sem id/event ou > 64 KB' })
  @ApiResponse({ status: 401, type: WebhookErrorDto, description: 'Token ausente ou inválido' })
  async receive(
    @Headers('asaas-access-token') token: string | undefined,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<WebhookAckDto> {
    // Fail closed: sem gateway Asaas configurado, nenhum token é válido.
    const expected = this.config.asaas?.webhookToken;
    if (!expected || !tokenMatches(token, expected)) {
      throw new WebhookRejected(401, 'unauthorized');
    }
    const declared = Number(req.headers['content-length'] ?? 0);
    if (
      declared > WEBHOOK_MAX_BYTES ||
      !isEvent(body) ||
      JSON.stringify(body).length > WEBHOOK_MAX_BYTES
    ) {
      throw new WebhookRejected(400, 'invalid_event');
    }
    await this.handle.execute(body);
    return { received: true };
  }
}

function isEvent(body: unknown): body is AsaasWebhookBodyDto & { [extra: string]: unknown } {
  return (
    typeof body === 'object' &&
    body !== null &&
    !Array.isArray(body) &&
    typeof (body as { id?: unknown }).id === 'string' &&
    (body as { id: string }).id !== '' &&
    typeof (body as { event?: unknown }).event === 'string'
  );
}
