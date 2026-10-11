/** Códigos de erro de validação do pedido (spec sponsorships FR-03). */
export type ValidationErrorCode =
  | 'invalid_slot'
  | 'invalid_minutes'
  | 'invalid_image'
  | 'image_too_large'
  | 'invalid_advertiser'
  | 'invalid_email'
  | 'terms_not_accepted';

/** Erro de domínio do módulo; o filtro HTTP traduz o `code` para o status (FR-03). */
export class SponsorshipError extends Error {
  constructor(
    readonly code: ValidationErrorCode | 'unavailable' | 'not_found' | 'expired' | 'price_changed',
  ) {
    super(code);
    this.name = 'SponsorshipError';
  }
}
