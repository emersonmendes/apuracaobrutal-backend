// Sinais brutos do analisador (spec sponsorship-image-moderation R-3). O adapter devolve as
// respostas do provedor sem interpretar; aqui só se valida a forma e se normaliza. Nenhum limiar,
// categoria ou decisão. Puro — sem NestJS, Prisma nem SDK.

/** Limite de palavras lidas pelo provedor numa imagem (R-3): atingido = texto não lido. */
export const TEXT_WORD_LIMIT = 100;
/** Limites gravados na auditoria (R-3). */
export const MAX_TEXT_LINES = 100;
export const MAX_TEXT_LINE_LENGTH = 500;
export const MAX_LABELS = 50;
export const MAX_CELEBRITIES = 64;

export interface ModerationLabelSignal {
  name: string;
  parentName: string | null;
  taxonomyLevel: 1 | 2 | 3;
  /** 0–100, como devolvido pelo provedor. */
  confidence: number;
}

export interface ContentTypeSignal {
  name: string;
  confidence: number;
}

export interface TextLineSignal {
  text: string;
  confidence: number;
}

export interface CelebritySignal {
  name: string;
  id: string;
  matchConfidence: number;
}

export interface ImageSignals {
  labels: ModerationLabelSignal[];
  contentTypes: ContentTypeSignal[];
  /** Só detecções `LINE`, na ordem devolvida. */
  textLines: TextLineSignal[];
  /** Detecções `WORD`. */
  wordCount: number;
  /** `wordCount ≥ TEXT_WORD_LIMIT`: há texto que não foi lido (D-1). */
  textSaturated: boolean;
  celebrities: CelebritySignal[];
}

export type NormalizeSignalsResult =
  | { ok: true; value: ImageSignals; truncated: string[] }
  | { ok: false; code: 'invalid_response'; detail: string };

/** Sinais vazios (adapter simulado). */
export function emptySignals(): ImageSignals {
  return {
    labels: [],
    contentTypes: [],
    textLines: [],
    wordCount: 0,
    textSaturated: false,
    celebrities: [],
  };
}

/** Forma crua que o adapter devolve: respostas do provedor, sem `$metadata`. */
export const EMPTY_RAW_SIGNALS = {
  moderation: { ModerationLabels: [], ContentTypes: [] },
  text: { TextDetections: [] },
  celebrities: { CelebrityFaces: [] },
};

type Raw = Record<string, unknown>;

const isObject = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function confidence(value: unknown, where: string, problems: string[]): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    problems.push(`${where}: confiança fora de [0, 100]`);
    return null;
  }
  return value;
}

function array(raw: Raw, field: string, where: string, problems: string[]): unknown[] | null {
  const value = raw[field];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    problems.push(`${where}.${field} não é array`);
    return null;
  }
  return value;
}

/**
 * Valida a forma das três respostas e produz `ImageSignals` (R-3). Item sem nome é descartado;
 * confiança inválida ou campo com tipo errado invalida a resposta inteira (`invalid_response`,
 * falha técnica — nunca aprovação, nunca recusa de conteúdo).
 */
export function normalizeSignals(raw: unknown): NormalizeSignalsResult {
  const problems: string[] = [];
  const truncated: string[] = [];
  if (!isObject(raw))
    return { ok: false, code: 'invalid_response', detail: 'resposta não é objeto' };
  const moderation = isObject(raw.moderation) ? raw.moderation : null;
  const text = isObject(raw.text) ? raw.text : null;
  const celebrities = isObject(raw.celebrities) ? raw.celebrities : null;
  if (!moderation || !text || !celebrities) {
    return {
      ok: false,
      code: 'invalid_response',
      detail: 'faltam as respostas de moderação, texto ou pessoas',
    };
  }

  const labels: ModerationLabelSignal[] = [];
  for (const item of array(moderation, 'ModerationLabels', 'moderation', problems) ?? []) {
    if (!isObject(item) || typeof item.Name !== 'string' || item.Name === '') continue;
    const value = confidence(item.Confidence, `rótulo ${item.Name}`, problems);
    if (value === null) continue;
    const level = item.TaxonomyLevel;
    const taxonomyLevel: 1 | 2 | 3 = level === 2 || level === 3 ? level : 1;
    labels.push({
      name: item.Name,
      parentName:
        typeof item.ParentName === 'string' && item.ParentName !== '' ? item.ParentName : null,
      taxonomyLevel,
      confidence: value,
    });
  }

  const contentTypes: ContentTypeSignal[] = [];
  for (const item of array(moderation, 'ContentTypes', 'moderation', problems) ?? []) {
    if (!isObject(item) || typeof item.Name !== 'string' || item.Name === '') continue;
    const value = confidence(item.Confidence, `tipo ${item.Name}`, problems);
    if (value !== null) contentTypes.push({ name: item.Name, confidence: value });
  }

  const textLines: TextLineSignal[] = [];
  let wordCount = 0;
  for (const item of array(text, 'TextDetections', 'text', problems) ?? []) {
    if (!isObject(item)) continue;
    if (item.DetectedText !== undefined && typeof item.DetectedText !== 'string') {
      problems.push('text: DetectedText não é string');
      continue;
    }
    if (item.Type === 'WORD') {
      wordCount += 1;
      continue;
    }
    if (item.Type !== 'LINE' || typeof item.DetectedText !== 'string' || item.DetectedText === '') {
      continue;
    }
    const value = confidence(item.Confidence, 'linha de texto', problems);
    if (value !== null) textLines.push({ text: item.DetectedText, confidence: value });
  }

  const faces: CelebritySignal[] = [];
  for (const item of array(celebrities, 'CelebrityFaces', 'celebrities', problems) ?? []) {
    if (!isObject(item) || typeof item.Name !== 'string' || item.Name === '') continue;
    const value = confidence(item.MatchConfidence, `pessoa ${item.Name}`, problems);
    if (value === null) continue;
    faces.push({
      name: item.Name,
      id: typeof item.Id === 'string' ? item.Id : '',
      matchConfidence: value,
    });
  }

  if (problems.length > 0) {
    return { ok: false, code: 'invalid_response', detail: problems.join('; ') };
  }

  if (labels.length > MAX_LABELS) {
    labels.length = MAX_LABELS;
    truncated.push('labels');
  }
  if (textLines.length > MAX_TEXT_LINES) {
    textLines.length = MAX_TEXT_LINES;
    truncated.push('textLines');
  }
  for (const line of textLines) {
    if (line.text.length > MAX_TEXT_LINE_LENGTH) {
      line.text = line.text.slice(0, MAX_TEXT_LINE_LENGTH);
      if (!truncated.includes('textLineLength')) truncated.push('textLineLength');
    }
  }
  if (faces.length > MAX_CELEBRITIES) {
    faces.length = MAX_CELEBRITIES;
    truncated.push('celebrities');
  }

  return {
    ok: true,
    truncated,
    value: {
      labels,
      contentTypes,
      textLines,
      wordCount,
      textSaturated: wordCount >= TEXT_WORD_LIMIT,
      celebrities: faces,
    },
  };
}
