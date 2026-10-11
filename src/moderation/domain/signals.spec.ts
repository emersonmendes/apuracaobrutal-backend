import { rawCelebrity, rawLabel, rawSignals } from '../application/__fakes__/fake-image-analyzer';
import { EMPTY_RAW_SIGNALS, emptySignals, normalizeSignals } from './signals';

describe('normalizeSignals — spec sponsorship-image-moderation R-3 (AC-02)', () => {
  it('resposta vazia → sinais vazios', () => {
    expect(normalizeSignals(EMPTY_RAW_SIGNALS)).toEqual({
      ok: true,
      truncated: [],
      value: emptySignals(),
    });
  });

  it('normaliza rótulos (nível e pai), tipos de conteúdo, linhas, contagem de palavras e rostos', () => {
    const result = normalizeSignals(
      rawSignals({
        labels: [rawLabel('Violence', 90.5), rawLabel('Weapons', 88, 'Violence')],
        contentTypes: [{ Name: 'Illustrated', Confidence: 70 }],
        lines: ['VOTE 13', 'Padaria Central'],
        celebrities: [rawCelebrity('Lula', 95, 'abc')],
      }),
    );
    expect(result).toEqual({
      ok: true,
      truncated: [],
      value: {
        labels: [
          { name: 'Violence', parentName: null, taxonomyLevel: 1, confidence: 90.5 },
          { name: 'Weapons', parentName: 'Violence', taxonomyLevel: 2, confidence: 88 },
        ],
        contentTypes: [{ name: 'Illustrated', confidence: 70 }],
        textLines: [
          { text: 'VOTE 13', confidence: 99 },
          { text: 'Padaria Central', confidence: 99 },
        ],
        wordCount: 4,
        textSaturated: false,
        celebrities: [{ name: 'Lula', id: 'abc', matchConfidence: 95 }],
      },
    });
  });

  it('100 palavras → textSaturated', () => {
    const result = normalizeSignals(rawSignals({ lines: ['a b'], wordCount: 100 }));
    expect(result.ok && result.value).toMatchObject({ wordCount: 100, textSaturated: true });
    const below = normalizeSignals(rawSignals({ lines: ['a b'], wordCount: 99 }));
    expect(below.ok && below.value.textSaturated).toBe(false);
  });

  it('item sem nome é descartado; ParentName vazio vira nulo; TaxonomyLevel ausente vira 1', () => {
    const result = normalizeSignals({
      moderation: {
        ModerationLabels: [{ Confidence: 90 }, { Name: 'Alcohol', Confidence: 70, ParentName: '' }],
      },
      text: { TextDetections: [{ Type: 'LINE', Confidence: 90 }] },
      celebrities: { CelebrityFaces: [{ MatchConfidence: 99 }] },
    });
    expect(result).toEqual({
      ok: true,
      truncated: [],
      value: {
        ...emptySignals(),
        labels: [{ name: 'Alcohol', parentName: null, taxonomyLevel: 1, confidence: 70 }],
      },
    });
  });

  it.each([
    ['não é objeto', 'texto'],
    ['falta uma das respostas', { moderation: {}, text: {} }],
    [
      'ModerationLabels não é array',
      { ...EMPTY_RAW_SIGNALS, moderation: { ModerationLabels: 'x' } },
    ],
    ['TextDetections não é array', { ...EMPTY_RAW_SIGNALS, text: { TextDetections: {} } }],
    ['CelebrityFaces não é array', { ...EMPTY_RAW_SIGNALS, celebrities: { CelebrityFaces: 1 } }],
    ['confiança fora de [0, 100]', rawSignals({ labels: [rawLabel('Explicit', 101)] })],
    [
      'confiança não numérica',
      {
        ...EMPTY_RAW_SIGNALS,
        moderation: { ModerationLabels: [{ Name: 'Explicit', Confidence: '9' }] },
      },
    ],
    [
      'DetectedText não é string',
      {
        ...EMPTY_RAW_SIGNALS,
        text: { TextDetections: [{ DetectedText: 5, Type: 'LINE', Confidence: 9 }] },
      },
    ],
    ['MatchConfidence inválida', rawSignals({ celebrities: [rawCelebrity('Lula', -1)] })],
  ])('%s → invalid_response', (_name, raw) => {
    expect(normalizeSignals(raw)).toMatchObject({ ok: false, code: 'invalid_response' });
  });

  it('trunca 50 rótulos, 100 linhas de 500 caracteres e 64 rostos, anotando o que truncou', () => {
    const result = normalizeSignals(
      rawSignals({
        labels: Array.from({ length: 60 }, (_, i) => rawLabel(`L${i}`, 55)),
        lines: Array.from({ length: 101 }, (_, i) => `linha ${i} ${'x'.repeat(600)}`),
        celebrities: Array.from({ length: 70 }, (_, i) => rawCelebrity(`P${i}`, 60)),
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.labels).toHaveLength(50);
    expect(result.value.textLines).toHaveLength(100);
    expect(result.value.textLines[0].text).toHaveLength(500);
    expect(result.value.celebrities).toHaveLength(64);
    expect(result.truncated).toEqual(['labels', 'textLines', 'textLineLength', 'celebrities']);
  });
});
