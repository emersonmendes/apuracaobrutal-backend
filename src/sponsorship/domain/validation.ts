import type { ValidationErrorCode } from './errors';
import { isSlot, type SponsorshipSlot } from './slots';

export interface RawOrderInput {
  slot?: unknown;
  minutes?: unknown;
  advertiserName?: unknown;
  email?: unknown;
  acceptTerms?: unknown;
}

export interface OrderInput {
  slot: SponsorshipSlot;
  minutes: number;
  advertiserName: string;
  email: string;
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
 * Valida os campos do pedido na ordem da FR-03 (R-3, R-8). Devolve o primeiro erro encontrado.
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

  if (raw.acceptTerms !== true && raw.acceptTerms !== 'true') {
    return { ok: false, code: 'terms_not_accepted' };
  }

  return { ok: true, value: { slot: raw.slot, minutes, advertiserName, email } };
}
