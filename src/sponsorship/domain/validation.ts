import type { ValidationErrorCode } from './errors';
import { normalizeLinkUrl } from './link-url';
import { normalizeCpfCnpj } from './payer';
import { isSlot, type SponsorshipSlot } from './slots';

export interface RawOrderInput {
  slot?: unknown;
  minutes?: unknown;
  advertiserName?: unknown;
  email?: unknown;
  cpfCnpj?: unknown;
  linkUrl?: unknown;
  acceptTerms?: unknown;
}

export interface OrderInput {
  slot: SponsorshipSlot;
  minutes: number;
  advertiserName: string;
  email: string;
  /** Só dígitos (asaas-payment R-2). */
  cpfCnpj: string;
  /** Link opcional do anúncio (sponsor-link R-1). */
  linkUrl?: string | null;
}

export type ValidationResult =
  { ok: true; value: OrderInput } | { ok: false; code: ValidationErrorCode };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseMinutes(raw: unknown, max: number): number | null {
  const text = typeof raw === 'number' ? String(raw) : raw;
  if (typeof text !== 'string' || !/^\d+$/.test(text.trim())) return null;
  const minutes = Number(text.trim());
  return minutes >= 1 && minutes <= max ? minutes : null;
}

/**
 * Valida os campos do pedido na ordem da FR-03 (R-3, R-8; CPF/CNPJ: asaas-payment R-2; link:
 * sponsor-link R-1). Devolve o primeiro erro encontrado.
 */
export function validateOrderInput(raw: RawOrderInput, maxMinutes: number): ValidationResult {
  if (!isSlot(raw.slot)) return { ok: false, code: 'invalid_slot' };

  const minutes = parseMinutes(raw.minutes, maxMinutes);
  if (minutes === null) return { ok: false, code: 'invalid_minutes' };

  const advertiserName = typeof raw.advertiserName === 'string' ? raw.advertiserName.trim() : '';
  if (advertiserName.length < 2 || advertiserName.length > 80) {
    return { ok: false, code: 'invalid_advertiser' };
  }

  const email = typeof raw.email === 'string' ? raw.email.trim() : '';
  if (email.length > 254 || !EMAIL.test(email)) return { ok: false, code: 'invalid_email' };

  const cpfCnpj = normalizeCpfCnpj(raw.cpfCnpj);
  if (cpfCnpj === null) return { ok: false, code: 'invalid_cpf_cnpj' };

  const link = normalizeLinkUrl(raw.linkUrl);
  if (!link.ok) return { ok: false, code: 'invalid_link_url' };

  if (raw.acceptTerms !== true && raw.acceptTerms !== 'true') {
    return { ok: false, code: 'terms_not_accepted' };
  }

  return {
    ok: true,
    value: { slot: raw.slot, minutes, advertiserName, email, cpfCnpj, linkUrl: link.value },
  };
}
