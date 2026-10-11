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

export type StorageOperation = 'save' | 'read' | 'remove';

/**
 * Falha de infraestrutura do armazenamento de imagens (spec sponsorship-s3-storage R-3, FR-04):
 * acesso negado, rede, timeout após as tentativas, resposta inválida, erro de disco que não seja
 * "não existe". A mensagem carrega só operação, chave, nome do erro e status HTTP — nunca
 * credenciais, cabeçalhos nem a imagem (R-4). O filtro HTTP responde `503 storage_error`.
 */
export class StorageError extends Error {
  readonly code = 'storage_error' as const;
  constructor(
    readonly operation: StorageOperation,
    readonly key: string,
    readonly cause: { name?: string | null; status?: number | null } = {},
  ) {
    super(
      `armazenamento de imagens: falha em ${operation} de ${key}` +
        (cause.name ? ` (${cause.name}` + (cause.status ? ` ${cause.status}` : '') + ')' : ''),
    );
    this.name = 'StorageError';
  }
}
