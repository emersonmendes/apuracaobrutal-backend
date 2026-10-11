import { HttpException } from '@nestjs/common';

/** Rejeição do webhook (asaas-payment R-6): `401 unauthorized` ou `400 invalid_event`. */
export class WebhookRejected extends HttpException {
  constructor(status: 400 | 401, code: 'unauthorized' | 'invalid_event') {
    super({ code }, status);
  }
}
