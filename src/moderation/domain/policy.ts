// Política determinística de decisão (spec sponsorship-image-moderation R-4). O modelo nunca
// aprova sozinho: toda resposta válida passa por D-1…D-8, em ordem, e todas as regras acionadas
// ficam registradas. Puro — sem NestJS, Prisma nem SDK.
import type { ModerationCategory } from './categories';
import { MODERATION_POLICY_VERSION, type ModelDecision, type ModerationResponse } from './contract';

export { MODERATION_POLICY_VERSION };

export type RuleId = 'D-1' | 'D-2' | 'D-3' | 'D-4' | 'D-5' | 'D-6' | 'D-7' | 'D-8';

/** Categorias de recusa obrigatória (D-2): confiança alta nunca as substitui. */
export const MANDATORY_REJECTION_CATEGORIES: readonly ModerationCategory[] = [
  'SEXUAL_CONTENT',
  'HATE_OR_DISCRIMINATION',
  'THREAT_OR_VIOLENCE',
  'GRAPHIC_VIOLENCE',
  'ELECTORAL_PROPAGANDA',
  'POLITICAL_ATTACK',
];

/** Padrões de instrução ao moderador dentro da imagem (D-5), sobre texto normalizado. */
export const INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore (as |todas as |suas )?(instrucoes|regras)/,
  /system prompt/,
  /voce e (agora|um|uma) /,
  /aprove (esta|essa|a) imagem/,
  /\bapprove\b/,
  /responda (apenas|somente|so) (com|approve)/,
  /(instrucao|instrucoes) (para|ao) (o )?(modelo|sistema|moderador|assistente)/,
  /moderacao automatica/,
  /jailbreak/,
];

/** Termos eleitorais fixos (D-6), comparados por palavra inteira sobre texto normalizado. */
export const ELECTORAL_TERMS: readonly string[] = [
  'vote',
  'vota',
  'votem',
  'votar',
  'voto',
  'votos',
  'candidato',
  'candidata',
  'candidatos',
  'candidatas',
  'candidatura',
  'eleicao',
  'eleicoes',
  'eleitoral',
  'reeleicao',
  'urna',
  'partido',
  'coligacao',
  'federacao partidaria',
  'santinho',
  '#vote',
  '#voto',
];

export interface DecisionContext {
  /** Confiança mínima para aprovar (D-4). */
  minConfidence: number;
  /** Nomes de urna dos dois candidatos (D-6); vazio sem snapshot. */
  ballotNames: string[];
}

export type DecisionInput =
  { kind: 'response'; response: ModerationResponse } | { kind: 'refusal' };

export interface Verdict {
  outcome: 'approved' | 'rejected';
  categories: ModerationCategory[];
  /** Todas as regras acionadas, na ordem D-1…D-8. */
  rules: RuleId[];
  modelDecision: ModelDecision | null;
  confidence: number | null;
}

/** Sem acentos, minúsculo, espaços únicos. */
export function normalizeText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `term` aparece como palavra(s) inteira(s) em `text` (ambos já normalizados)? */
export function containsWholeWord(text: string, term: string): boolean {
  if (term === '') return false;
  return new RegExp(`(^|[^a-z])${escapeRegExp(term)}([^a-z]|$)`).test(text);
}

function matchesInjection(detectedText: string[]): boolean {
  return detectedText.some((item) => {
    const text = normalizeText(item);
    return INJECTION_PATTERNS.some((pattern) => pattern.test(text));
  });
}

function matchesElectoral(detectedText: string[], ballotNames: string[]): boolean {
  const names = ballotNames.map(normalizeText).filter((name) => name !== '');
  return detectedText.some((item) => {
    const text = normalizeText(item);
    return (
      ELECTORAL_TERMS.some((term) => containsWholeWord(text, term)) ||
      names.some((name) => containsWholeWord(text, name))
    );
  });
}

function withCategory(
  categories: ModerationCategory[],
  extra: ModerationCategory,
): ModerationCategory[] {
  return categories.includes(extra) ? categories : [...categories, extra];
}

/** Aplica D-1…D-8 (R-4). Falha técnica não passa por aqui (R-5). */
export function decide(input: DecisionInput, context: DecisionContext): Verdict {
  if (input.kind === 'refusal') {
    return {
      outcome: 'rejected',
      categories: ['OTHER_POLICY_VIOLATION'],
      rules: ['D-7'],
      modelDecision: null,
      confidence: null,
    };
  }
  const { response } = input;
  const rules: RuleId[] = [];
  let categories = [...response.categories];

  if (response.decision === 'REJECT') rules.push('D-1');
  if (categories.some((category) => MANDATORY_REJECTION_CATEGORIES.includes(category))) {
    rules.push('D-2');
  }
  if (categories.length > 0) rules.push('D-3');
  if (response.confidence < context.minConfidence) rules.push('D-4');
  if (matchesInjection(response.detectedText)) {
    rules.push('D-5');
    categories = withCategory(categories, 'OTHER_POLICY_VIOLATION');
  }
  if (matchesElectoral(response.detectedText, context.ballotNames)) {
    rules.push('D-6');
    categories = withCategory(categories, 'ELECTORAL_PROPAGANDA');
  }

  const base = { modelDecision: response.decision, confidence: response.confidence };
  if (rules.length > 0) return { outcome: 'rejected', categories, rules, ...base };
  return { outcome: 'approved', categories: [], rules: ['D-8'], ...base };
}
