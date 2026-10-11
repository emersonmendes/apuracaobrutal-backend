import { MODERATION_POLICY_VERSION } from '../domain/contract';
import { FakeImageAnalyzer } from './__fakes__/fake-image-analyzer';
import { ModerateImage } from './moderate-image';

const input = {
  image: Buffer.from('WEBP:fake'),
  mediaType: 'image/webp' as const,
  placement: 'faixa central',
};
const context = { minConfidence: 0.85, ballotNames: ['Lula', 'Flávio Bolsonaro'] };
const ok = (overrides: Record<string, unknown> = {}) => ({
  decision: 'APPROVE',
  categories: [],
  detected_text: ['Padaria Central'],
  reasons: ['Publicidade comercial.'],
  confidence: 0.97,
  policy_version: MODERATION_POLICY_VERSION,
  ...overrides,
});

describe('ModerateImage — spec sponsorship-image-moderation FR-04, R-5', () => {
  it('aprova uma resposta válida e devolve metadados da chamada', async () => {
    const analyzer = new FakeImageAnalyzer().respond(JSON.stringify(ok()));
    const result = await new ModerateImage(analyzer, 1_000).execute(input, context);
    expect(result).toMatchObject({
      outcome: 'approved',
      provider: 'claude',
      model: 'fake-model',
      requestId: 'req_1',
      inputTokens: 1500,
      outputTokens: 120,
      policyVersion: '1.0',
      verdict: { rules: ['D-8'] },
    });
    expect(analyzer.calls).toEqual([input]);
  });

  it('recusa pela política quando a resposta aponta violação', async () => {
    const analyzer = new FakeImageAnalyzer().respond(
      ok({ decision: 'REJECT', categories: ['ELECTORAL_PROPAGANDA'], confidence: 0.9 }),
    );
    const result = await new ModerateImage(analyzer, 1_000).execute(input, context);
    expect(result.outcome).toBe('rejected');
    expect(result.outcome === 'rejected' && result.verdict.categories).toEqual([
      'ELECTORAL_PROPAGANDA',
    ]);
  });

  it.each([
    'timeout',
    'rate_limited',
    'provider_unavailable',
    'provider_rejected',
    'internal',
  ] as const)(
    'falha %s do analisador → error com o código (AC-06, cenários 19–21)',
    async (code) => {
      const analyzer = new FakeImageAnalyzer().fail(code);
      const result = await new ModerateImage(analyzer, 1_000).execute(input, context);
      expect(result).toMatchObject({ outcome: 'error', errorCode: code, model: null });
    },
  );

  it('resposta malformada → error invalid_response, nunca aprovação (AC-02, cenário 18)', async () => {
    for (const raw of ['não é json', ok({ policy_version: '0.9' }), ok({ decision: 'MAYBE' })]) {
      const analyzer = new FakeImageAnalyzer().respond(raw);
      const result = await new ModerateImage(analyzer, 1_000).execute(input, context);
      expect(result).toMatchObject({
        outcome: 'error',
        errorCode: 'invalid_response',
        model: 'fake-model',
      });
    }
  });

  it('JSON cortado por max_tokens → invalid_response', async () => {
    const analyzer = new FakeImageAnalyzer().respond('{"decision":"APPROVE","categories":[');
    const result = await new ModerateImage(analyzer, 1_000).execute(input, context);
    expect(result).toMatchObject({ outcome: 'error', errorCode: 'invalid_response' });
  });

  it('analisador que não responde → timeout pelo AbortSignal do caso de uso', async () => {
    const analyzer = new FakeImageAnalyzer().hang();
    const result = await new ModerateImage(analyzer, 30).execute(input, context);
    expect(result).toMatchObject({ outcome: 'error', errorCode: 'timeout' });
  });

  it('recusa do provedor → rejected OTHER_POLICY_VIOLATION (AC-09)', async () => {
    const analyzer = new FakeImageAnalyzer().refuse();
    const result = await new ModerateImage(analyzer, 1_000).execute(input, context);
    expect(result).toMatchObject({
      outcome: 'rejected',
      response: null,
      verdict: { rules: ['D-7'], categories: ['OTHER_POLICY_VIOLATION'] },
    });
  });

  it('exceção inesperada do analisador → error internal', async () => {
    const analyzer = {
      name: 'claude' as const,
      analyze: async () => {
        throw new Error('boom');
      },
    };
    const result = await new ModerateImage(analyzer, 1_000).execute(input, context);
    expect(result).toMatchObject({ outcome: 'error', errorCode: 'internal' });
  });
});
