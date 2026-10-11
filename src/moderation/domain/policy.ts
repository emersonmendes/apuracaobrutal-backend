// Política determinística de decisão v2.1 (spec sponsorship-image-moderation R-4). O provedor
// nunca decide: todo `ImageSignals` válido passa por D-1…D-7, em ordem, e todas as regras
// acionadas ficam registradas. Puro — sem NestJS, Prisma nem SDK.
import type { ModerationCategory } from './categories';
import { categoryForLabel } from './label-map';
import { PARTY_TERMS } from './party-terms';
import type { ImageSignals, ModerationLabelSignal } from './signals';

export const MODERATION_POLICY_VERSION = '2.1';

export type RuleId = 'D-1' | 'D-2' | 'D-3' | 'D-4' | 'D-5' | 'D-6' | 'D-7';

/** Padrões de instrução ao moderador dentro da imagem (D-4), sobre texto normalizado. */
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

/** Termos eleitorais fixos (D-5), comparados por token inteiro sobre texto normalizado. */
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

export interface CandidateIdentityRef {
  ballotName: string;
  number: number;
}

export interface DecisionContext {
  /** Confiança mínima (0–100) para um rótulo recusar (D-2/D-3). */
  labelMinConfidence: number;
  /** `matchConfidence` mínima (0–100) para um rosto reconhecido contar (D-6). */
  celebrityMinConfidence: number;
  /** Nome e número de urna dos dois lados (D-5, D-6); vazio sem snapshot. */
  candidates: CandidateIdentityRef[];
}

export interface Verdict {
  outcome: 'approved' | 'rejected';
  categories: ModerationCategory[];
  /** Todas as regras acionadas, na ordem D-1…D-7. */
  rules: RuleId[];
  /** Maior confiança (0–1) entre os sinais que acionaram D-2/D-3/D-6; nulo sem esses sinais. */
  confidence: number | null;
  /** Uma frase objetiva em pt-BR por regra acionada (R-3). */
  reasons: string[];
}

/** Sem acentos, minúsculo, espaços únicos. */
export function normalizeText(text: string): string {
  return stripAccents(text).toLowerCase();
}

/** Sem acentos e com espaços únicos, preservando a caixa (siglas ambíguas de partido, D-5). */
export function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim();
}

const EDGE_PUNCTUATION = /^[.,;:!?()"'«»[\]{}]+|[.,;:!?()"'«»[\]{}]+$/g;

/**
 * Tokens de um texto já normalizado: separados por espaço, com pontuação removida só das pontas
 * (`"13."` → `13`; `"13,90"` e `"13/10"` ficam inteiros) — R-4 D-5.
 */
export function tokenize(normalized: string): string[] {
  return normalized
    .split(' ')
    .map((token) => token.replace(EDGE_PUNCTUATION, ''))
    .filter((token) => token !== '');
}

/** `needle` (tokens) aparece como sequência contígua em `haystack` (tokens)? */
export function containsTokenSequence(
  haystack: readonly string[],
  needle: readonly string[],
): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  outer: for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

/** Todos os tokens de `needle` estão em `haystack` (qualquer ordem)? */
export function containsAllTokens(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0) return false;
  const set = new Set(haystack);
  return needle.every((token) => set.has(token));
}

const percent = (value: number) => `${value.toFixed(1).replace('.', ',')} %`;

function withCategory(
  categories: ModerationCategory[],
  extra: ModerationCategory,
): ModerationCategory[] {
  return categories.includes(extra) ? categories : [...categories, extra];
}

interface LabelHit {
  label: ModerationLabelSignal;
  category: ModerationCategory;
  mandatory: boolean;
}

/**
 * Rótulos acima do limiar, um por família: um rótulo pai (ex.: `Violence`) sai quando um filho
 * seu (ex.: `Weapons`) também passou do limiar — a tabela resolve `Violence` pelo L2. A confiança
 * do acerto é a maior da cadeia (o L1 costuma vir com confiança maior que o L3).
 */
function labelHits(signals: ImageSignals, minConfidence: number): LabelHit[] {
  const above = signals.labels.filter((label) => label.confidence >= minConfidence);
  const parents = new Set(above.map((label) => label.parentName).filter((name) => name !== null));
  const byName = new Map(signals.labels.map((label) => [label.name, label] as const));
  const hits: LabelHit[] = [];
  for (const label of above) {
    if (parents.has(label.name)) continue;
    const { category, mandatory } = categoryForLabel(label, signals.labels);
    let confidence = label.confidence;
    let current: ModerationLabelSignal | undefined = label;
    for (let depth = 0; current?.parentName && depth < 3; depth += 1) {
      current = byName.get(current.parentName);
      if (current) confidence = Math.max(confidence, current.confidence);
    }
    hits.push({ label: { ...label, confidence }, category, mandatory });
  }
  return hits;
}

/** Aplica D-1…D-7 (R-4). Falha técnica não passa por aqui (R-5). */
export function decide(signals: ImageSignals, context: DecisionContext): Verdict {
  const rules: RuleId[] = [];
  const reasons: string[] = [];
  let categories: ModerationCategory[] = [];
  let maxConfidence: number | null = null;
  const bump = (value: number) => {
    maxConfidence = maxConfidence === null ? value : Math.max(maxConfidence, value);
  };

  // D-1 — texto saturado: há texto que não foi lido; impossível avaliar.
  if (signals.textSaturated) {
    rules.push('D-1');
    reasons.push(
      `Texto da imagem excede o limite de ${signals.wordCount} palavras lidas; parte não foi avaliada (D-1).`,
    );
  }

  // D-2 / D-3 — rótulos do provedor acima do limiar.
  const hits = labelHits(signals, context.labelMinConfidence);
  const mandatory = hits.filter((hit) => hit.mandatory);
  const others = hits.filter((hit) => !hit.mandatory);
  if (mandatory.length > 0) {
    rules.push('D-2');
    for (const hit of mandatory) {
      categories = withCategory(categories, hit.category);
      bump(hit.label.confidence);
      reasons.push(
        `Rótulo "${hit.label.name}" com confiança ${percent(hit.label.confidence)} (D-2).`,
      );
    }
  }
  if (others.length > 0) {
    rules.push('D-3');
    for (const hit of others) {
      categories = withCategory(categories, hit.category);
      bump(hit.label.confidence);
      reasons.push(
        `Rótulo "${hit.label.name}" com confiança ${percent(hit.label.confidence)} (D-3).`,
      );
    }
  }

  // D-4 — instrução ao moderador dentro da imagem.
  const normalizedLines = signals.textLines.map((line) => normalizeText(line.text));
  const caseLines = signals.textLines.map((line) => stripAccents(line.text));
  const injection = normalizedLines.find((line) =>
    INJECTION_PATTERNS.some((pattern) => pattern.test(line)),
  );
  if (injection !== undefined) {
    rules.push('D-4');
    categories = withCategory(categories, 'OTHER_POLICY_VIOLATION');
    reasons.push('Texto da imagem contém instrução dirigida ao moderador (D-4).');
  }

  // D-5 — termos eleitorais, partidos, nomes e números de urna (o motivo cita a linha original lida).
  const electoral = findElectoralText(normalizedLines, caseLines, context.candidates);
  if (electoral !== null) {
    rules.push('D-5');
    categories = withCategory(categories, 'ELECTORAL_PROPAGANDA');
    reasons.push(`Texto eleitoral: "${signals.textLines[electoral].text}" (D-5).`);
  }

  // D-6 — rosto reconhecido de um dos dois candidatos.
  const face = signals.celebrities.find(
    (person) =>
      person.matchConfidence >= context.celebrityMinConfidence &&
      matchesCandidate(person.name, context.candidates),
  );
  if (face !== undefined) {
    rules.push('D-6');
    categories = withCategory(categories, 'ELECTORAL_PROPAGANDA');
    bump(face.matchConfidence);
    reasons.push(
      `Pessoa pública reconhecida corresponde a um candidato (confiança ${percent(face.matchConfidence)}) (D-6).`,
    );
  }

  const confidence = maxConfidence === null ? null : Math.round(maxConfidence * 10) / 1000;
  if (rules.length > 0) return { outcome: 'rejected', categories, rules, confidence, reasons };
  return { outcome: 'approved', categories: [], rules: ['D-7'], confidence: null, reasons: [] };
}

/** Índice da primeira linha que aciona D-5, ou `null`. */
function findElectoralText(
  normalizedLines: readonly string[],
  caseLines: readonly string[],
  candidates: readonly CandidateIdentityRef[],
): number | null {
  const names = candidates
    .map((candidate) => tokenize(normalizeText(candidate.ballotName)))
    .filter((tokens) => tokens.length > 0);
  const numbers = candidates.map((candidate) => String(candidate.number));
  const terms = ELECTORAL_TERMS.map((term) => tokenize(normalizeText(term)));
  const parties = PARTY_TERMS.filter((party) => !party.ambiguous).map((party) =>
    tokenize(normalizeText(party.term)),
  );
  // Siglas que coincidem com palavra comum só valem em MAIÚSCULAS na linha original.
  const upperParties = PARTY_TERMS.filter((party) => party.ambiguous).map((party) =>
    tokenize(stripAccents(party.term).toUpperCase()),
  );
  for (const [index, line] of normalizedLines.entries()) {
    const tokens = tokenize(line);
    const caseTokens = tokenize(caseLines[index] ?? '');
    if (
      terms.some((term) => containsTokenSequence(tokens, term)) ||
      parties.some((party) => containsTokenSequence(tokens, party)) ||
      upperParties.some((party) => containsTokenSequence(caseTokens, party)) ||
      names.some((name) => containsTokenSequence(tokens, name)) ||
      numbers.some((number) => tokens.includes(number))
    ) {
      return index;
    }
  }
  return null;
}

/** Nome reconhecido contém todos os tokens do nome de urna de um dos lados (D-6)? */
export function matchesCandidate(
  personName: string,
  candidates: readonly CandidateIdentityRef[],
): boolean {
  const personTokens = tokenize(normalizeText(personName));
  return candidates.some((candidate) =>
    containsAllTokens(personTokens, tokenize(normalizeText(candidate.ballotName))),
  );
}
