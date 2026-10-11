// Contrato da resposta do analisador (spec sponsorship-image-moderation R-3): schema enviado à API
// como saída estruturada e validação estrita no backend, sem biblioteca. Puro.
import { MODERATION_CATEGORIES, isModerationCategory, type ModerationCategory } from './categories';

/** Versão da política/prompt. Mudou a R-1 ou a R-4 → nova versão (R-1). */
export const MODERATION_POLICY_VERSION = '1.0';

export const MAX_DETECTED_TEXT_ITEMS = 50;
export const MAX_DETECTED_TEXT_LENGTH = 500;
export const MAX_REASONS = 10;
export const MAX_REASON_LENGTH = 1000;

export type ModelDecision = 'APPROVE' | 'REJECT';

export interface ModerationResponse {
  decision: ModelDecision;
  categories: ModerationCategory[];
  detectedText: string[];
  reasons: string[];
  /** `[0, 1]`; sinal do modelo, nunca probabilidade calibrada (R-3). */
  confidence: number;
  policyVersion: string;
}

/**
 * JSON Schema do contrato, no subconjunto aceito pela saída estruturada da API (tipos, `enum`,
 * `required`, `additionalProperties: false`). Limites de tamanho ficam na validação do backend.
 */
export const MODERATION_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['decision', 'categories', 'detected_text', 'reasons', 'confidence', 'policy_version'],
  properties: {
    decision: { type: 'string', enum: ['APPROVE', 'REJECT'] },
    categories: { type: 'array', items: { type: 'string', enum: [...MODERATION_CATEGORIES] } },
    detected_text: { type: 'array', items: { type: 'string' } },
    reasons: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number' },
    policy_version: { type: 'string', enum: [MODERATION_POLICY_VERSION] },
  },
} as const;

export type ParseResult =
  { ok: true; value: ModerationResponse } | { ok: false; code: 'invalid_response'; detail: string };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const invalid = (detail: string): ParseResult => ({ ok: false, code: 'invalid_response', detail });

function stringArray(value: unknown, max: number, maxLength: number): string[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.length > maxLength) return null;
    items.push(item);
  }
  return items;
}

/**
 * Valida a resposta crua (texto JSON ou objeto). Qualquer desvio do contrato é falha técnica da
 * tentativa (`invalid_response`), nunca aprovação nem recusa de conteúdo (R-3, R-5).
 */
export function parseModerationResponse(raw: unknown): ParseResult {
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return invalid('JSON inválido');
    }
  }
  if (!isObject(data)) return invalid('resposta não é um objeto');
  const expected = new Set<string>(MODERATION_RESPONSE_JSON_SCHEMA.required);
  for (const key of Object.keys(data)) if (!expected.has(key)) return invalid(`campo extra ${key}`);
  for (const key of expected) if (!(key in data)) return invalid(`campo ausente ${key}`);

  const { decision, categories, confidence } = data;
  if (decision !== 'APPROVE' && decision !== 'REJECT') return invalid('decision inválida');
  if (!Array.isArray(categories)) return invalid('categories não é lista');
  const seen = new Set<string>();
  for (const category of categories) {
    if (!isModerationCategory(category)) return invalid('categoria desconhecida');
    if (seen.has(category)) return invalid('categoria repetida');
    seen.add(category);
  }
  const detectedText = stringArray(
    data.detected_text,
    MAX_DETECTED_TEXT_ITEMS,
    MAX_DETECTED_TEXT_LENGTH,
  );
  if (!detectedText) return invalid('detected_text fora dos limites');
  const reasons = stringArray(data.reasons, MAX_REASONS, MAX_REASON_LENGTH);
  if (!reasons || reasons.length === 0) return invalid('reasons fora dos limites');
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) {
    return invalid('confidence não é número');
  }
  if (confidence < 0 || confidence > 1) return invalid('confidence fora de [0, 1]');
  if (data.policy_version !== MODERATION_POLICY_VERSION) return invalid('policy_version diferente');

  return {
    ok: true,
    value: {
      decision,
      categories: [...seen] as ModerationCategory[],
      detectedText,
      reasons,
      confidence,
      policyVersion: MODERATION_POLICY_VERSION,
    },
  };
}
