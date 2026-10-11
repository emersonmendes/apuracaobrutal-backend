import { FakeImageAnalyzer, rawLabel, rawSignals } from './__fakes__/fake-image-analyzer';
import { ModerateImage } from './moderate-image';

const input = { image: Buffer.from('WEBP:fake'), mediaType: 'image/webp' as const };
const context = {
  labelMinConfidence: 60,
  celebrityMinConfidence: 90,
  candidates: [
    { ballotName: 'Lula', number: 13 },
    { ballotName: 'Flávio Bolsonaro', number: 22 },
  ],
};

describe('ModerateImage — spec sponsorship-image-moderation FR-04, R-5', () => {
  it('aprova sinais limpos e devolve metadados da chamada', async () => {
    const analyzer = new FakeImageAnalyzer().respond(rawSignals({ lines: ['Padaria Central'] }));
    const result = await new ModerateImage(analyzer, 1_000).execute(input, context);
    expect(result).toMatchObject({
      outcome: 'approved',
      provider: 'rekognition',
      model: 'fake-model',
      requestId: 'req_1',
      policyVersion: '2.0',
      verdict: { rules: ['D-7'], reasons: [] },
      signals: { textLines: [{ text: 'Padaria Central', confidence: 99 }], wordCount: 2 },
    });
    expect(analyzer.calls).toEqual([input]);
  });

  it('recusa pela política quando um rótulo passa do limiar', async () => {
    const analyzer = new FakeImageAnalyzer().respond(
      rawSignals({ labels: [rawLabel('Explicit', 98)] }),
    );
    const result = await new ModerateImage(analyzer, 1_000).execute(input, context);
    expect(result).toMatchObject({
      outcome: 'rejected',
      verdict: { categories: ['SEXUAL_CONTENT'], rules: ['D-2'], confidence: 0.98 },
    });
  });

  it('recusa por texto eleitoral mesmo sem rótulo (D-5)', async () => {
    const analyzer = new FakeImageAnalyzer().respond(rawSignals({ lines: ['VOTE 13'] }));
    const result = await new ModerateImage(analyzer, 1_000).execute(input, context);
    expect(result).toMatchObject({
      outcome: 'rejected',
      verdict: { categories: ['ELECTORAL_PROPAGANDA'], rules: ['D-5'] },
    });
  });

  it.each([
    'timeout',
    'rate_limited',
    'provider_unavailable',
    'provider_rejected',
    'internal',
  ] as const)('falha %s do analisador → error com o código (AC-07)', async (code) => {
    const analyzer = new FakeImageAnalyzer().fail(code);
    const result = await new ModerateImage(analyzer, 1_000).execute(input, context);
    expect(result).toMatchObject({ outcome: 'error', errorCode: code, model: null });
  });

  it('resposta malformada → error invalid_response, nunca aprovação (AC-02)', async () => {
    for (const raw of [
      'não é objeto',
      { moderation: {} },
      rawSignals({ labels: [rawLabel('X', 200)] }),
    ]) {
      const analyzer = new FakeImageAnalyzer().respond(raw);
      const result = await new ModerateImage(analyzer, 1_000).execute(input, context);
      expect(result).toMatchObject({
        outcome: 'error',
        errorCode: 'invalid_response',
        model: 'fake-model',
      });
    }
  });

  it('sinais truncados são anotados nos motivos', async () => {
    const analyzer = new FakeImageAnalyzer().respond(
      rawSignals({ labels: Array.from({ length: 51 }, (_, i) => rawLabel(`L${i}`, 51)) }),
    );
    const result = await new ModerateImage(analyzer, 1_000).execute(input, context);
    expect(result.outcome).toBe('approved');
    expect(result.outcome === 'approved' && result.verdict.reasons).toEqual([
      'Sinais truncados para a auditoria: labels.',
    ]);
  });

  it('analisador que não responde → timeout pelo AbortSignal do caso de uso', async () => {
    const analyzer = new FakeImageAnalyzer().hang();
    const result = await new ModerateImage(analyzer, 30).execute(input, context);
    expect(result).toMatchObject({ outcome: 'error', errorCode: 'timeout' });
  });

  it('exceção inesperada do analisador → error internal', async () => {
    const analyzer = {
      name: 'rekognition' as const,
      analyze: async () => {
        throw new Error('boom');
      },
    };
    const result = await new ModerateImage(analyzer, 1_000).execute(input, context);
    expect(result).toMatchObject({ outcome: 'error', errorCode: 'internal' });
  });
});
