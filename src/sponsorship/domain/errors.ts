/** Códigos de erro de validação do pedido (spec sponsorships FR-03). */
export type ValidationErrorCode =
  | 'invalid_slot'
  | 'invalid_minutes'
  | 'invalid_image'
  | 'image_too_large'
  | 'invalid_advertiser'
  | 'invalid_email'
  | 'invalid_cpf_cnpj'
  | 'invalid_link_url'
  | 'terms_not_accepted';

/** Erro de domínio do módulo; o filtro HTTP traduz o `code` para o status (FR-03). */
export class SponsorshipError extends Error {
  constructor(
    readonly code:
      | ValidationErrorCode
      | 'unavailable'
      | 'not_found'
      | 'expired'
      | 'price_changed'
      | 'already_paid'
      | 'moderation_pending'
      | 'moderation_rejected'
      | 'moderation_error',
  ) {
    super(code);
    this.name = 'SponsorshipError';
  }
}

/**
 * Falha ao falar com o gateway de pagamento (spec asaas-payment R-3): HTTP ≠ 2xx, timeout ou
 * resposta fora do contrato. Nunca carrega a chave de API nem dados do pagador; o filtro HTTP
 * responde `502 gateway_error`.
 */
export class GatewayError extends Error {
  readonly code = 'gateway_error' as const;
  constructor(
    message: string,
    readonly status: number | null = null,
    readonly gatewayCode: string | null = null,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}
