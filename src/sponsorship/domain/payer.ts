// Pagador da cobrança (spec asaas-payment R-2): CPF/CNPJ validado no domínio, só dígitos.

const CPF_LENGTH = 11;
const CNPJ_LENGTH = 14;

/** Dígito verificador módulo 11: `weights` casa com os dígitos já conhecidos. */
function checkDigit(digits: number[], weights: number[]): number {
  const sum = weights.reduce((acc, weight, index) => acc + weight * digits[index], 0);
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

function isValidCpf(digits: number[]): boolean {
  const first = checkDigit(digits, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(digits, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return digits[9] === first && digits[10] === second;
}

function isValidCnpj(digits: number[]): boolean {
  const first = checkDigit(digits, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(digits, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return digits[12] === first && digits[13] === second;
}

/**
 * Normaliza um CPF/CNPJ (R-2): remove pontuação, exige 11 ou 14 dígitos, rejeita sequências de
 * dígitos iguais e confere os dois dígitos verificadores. Devolve só os dígitos, ou `null`.
 */
export function normalizeCpfCnpj(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/[.\-/\s]/g, '');
  if (!/^\d+$/.test(text)) return null;
  if (text.length !== CPF_LENGTH && text.length !== CNPJ_LENGTH) return null;
  if (/^(\d)\1+$/.test(text)) return null;
  const digits = [...text].map(Number);
  const valid = text.length === CPF_LENGTH ? isValidCpf(digits) : isValidCnpj(digits);
  return valid ? text : null;
}
