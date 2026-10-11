import { MODERATION_CATEGORIES } from './categories';
import {
  MAX_DETECTED_TEXT_ITEMS,
  MAX_REASONS,
  MODERATION_POLICY_VERSION,
  MODERATION_RESPONSE_JSON_SCHEMA,
  parseModerationResponse,
} from './contract';

const valid = (overrides: Record<string, unknown> = {}) => ({
  decision: 'APPROVE',
  categories: [],
  detected_text: ['Padaria Central — pão quentinho'],
  reasons: ['Publicidade comercial de padaria, sem violação.'],
  confidence: 0.96,
  policy_version: MODERATION_POLICY_VERSION,
  ...overrides,
});

describe('parseModerationResponse — spec sponsorship-image-moderation R-3 (AC-02)', () => {
  it('aceita uma resposta válida (objeto ou texto JSON)', () => {
    const asObject = parseModerationResponse(valid());
    expect(asObject).toEqual({
      ok: true,
      value: {
        decision: 'APPROVE',
        categories: [],
        detectedText: ['Padaria Central — pão quentinho'],
        reasons: ['Publicidade comercial de padaria, sem violação.'],
        confidence: 0.96,
        policyVersion: '1.0',
      },
    });
    expect(parseModerationResponse(JSON.stringify(valid()))).toEqual(asObject);
  });

  it('aceita várias categorias e decisão REJECT', () => {
    const result = parseModerationResponse(
      valid({ decision: 'REJECT', categories: ['ELECTORAL_PROPAGANDA', 'OFFENSIVE_LANGUAGE'] }),
    );
    expect(result.ok && result.value.categories).toEqual([
      'ELECTORAL_PROPAGANDA',
      'OFFENSIVE_LANGUAGE',
    ]);
  });

  it.each([
    ['JSON inválido', '{"decision": '],
    ['texto fora do JSON', 'Claro! {"decision":"APPROVE"}'],
    ['lista em vez de objeto', '[]'],
    [
      'campo ausente',
      (() => {
        const v = valid() as Record<string, unknown>;
        delete v.reasons;
        return v;
      })(),
    ],
    ['campo extra', valid({ note: 'x' })],
    ['decision desconhecida', valid({ decision: 'MAYBE' })],
    ['categoria desconhecida', valid({ categories: ['SPAM'] })],
    ['categoria repetida', valid({ categories: ['SEXUAL_CONTENT', 'SEXUAL_CONTENT'] })],
    ['categories não lista', valid({ categories: 'SEXUAL_CONTENT' })],
    ['detected_text com não-string', valid({ detected_text: [1] })],
    [
      'detected_text acima do limite',
      valid({ detected_text: Array(MAX_DETECTED_TEXT_ITEMS + 1).fill('x') }),
    ],
    ['reasons vazio', valid({ reasons: [] })],
    ['reasons acima do limite', valid({ reasons: Array(MAX_REASONS + 1).fill('x') })],
    ['confidence texto', valid({ confidence: '0.9' })],
    ['confidence > 1', valid({ confidence: 1.2 })],
    ['confidence < 0', valid({ confidence: -0.1 })],
    ['confidence NaN', valid({ confidence: Number.NaN })],
    ['policy_version diferente', valid({ policy_version: '0.9' })],
    ['nulo', null],
  ])('%s → invalid_response', (_, raw) => {
    const result = parseModerationResponse(raw);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.code).toBe('invalid_response');
  });

  it('o schema enviado à API lista as 14 categorias e a versão da política', () => {
    expect(MODERATION_RESPONSE_JSON_SCHEMA.properties.categories.items.enum).toEqual([
      ...MODERATION_CATEGORIES,
    ]);
    expect(MODERATION_RESPONSE_JSON_SCHEMA.properties.policy_version.enum).toEqual(['1.0']);
    expect(MODERATION_RESPONSE_JSON_SCHEMA.additionalProperties).toBe(false);
  });
});
