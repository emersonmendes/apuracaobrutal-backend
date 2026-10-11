import {
  DetectModerationLabelsCommand,
  DetectTextCommand,
  RecognizeCelebritiesCommand,
} from '@aws-sdk/client-rekognition';
import sharp = require('sharp');
import { AnalyzerError } from '../../domain/errors';
import {
  classify,
  RekognitionImageAnalyzer,
  type RekognitionClientLike,
} from './rekognition-image-analyzer';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface Sent {
  name: string;
  input: Record<string, unknown>;
  abortSignal: AbortSignal | undefined;
}

/** Cliente falso: registra cada comando e responde por nome do comando. */
class FakeClient implements RekognitionClientLike {
  readonly sent: Sent[] = [];
  readonly responses = new Map<string, unknown>();
  readonly failures = new Map<string, unknown>();

  constructor() {
    this.responses.set('DetectModerationLabelsCommand', {
      $metadata: { requestId: 'req-mod', httpStatusCode: 200 },
      ModerationLabels: [{ Name: 'Alcohol', Confidence: 71.2, TaxonomyLevel: 1 }],
      ContentTypes: [],
      ModerationModelVersion: '7.0',
    });
    this.responses.set('DetectTextCommand', {
      $metadata: { requestId: 'req-text' },
      TextDetections: [{ DetectedText: 'Padaria', Type: 'LINE', Confidence: 99 }],
      TextModelVersion: '3.0',
    });
    this.responses.set('RecognizeCelebritiesCommand', {
      $metadata: { requestId: 'req-cel' },
      CelebrityFaces: [],
      UnrecognizedFaces: [],
    });
  }

  async send(command: unknown, options?: { abortSignal?: AbortSignal }): Promise<unknown> {
    const name = (command as { constructor: { name: string } }).constructor.name;
    this.sent.push({
      name,
      input: (command as { input: Record<string, unknown> }).input,
      abortSignal: options?.abortSignal,
    });
    if (this.failures.has(name)) throw this.failures.get(name);
    return this.responses.get(name);
  }
}

const webp = () =>
  sharp({ create: { width: 120, height: 120, channels: 3, background: { r: 200, g: 30, b: 30 } } })
    .webp()
    .toBuffer();

const awsError = (name: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(`mensagem original com arn:aws:iam::123456789012:user/x`), {
    name,
    ...extra,
  });

describe('RekognitionImageAnalyzer — spec sponsorship-image-moderation FR-04, R-5, R-8 (AC-15, AC-17)', () => {
  const options = { region: 'us-east-1', profile: null, timeoutMs: 5_000 };

  it('converte o WebP em PNG, envia as três operações com os mesmos bytes e devolve as respostas cruas', async () => {
    const client = new FakeClient();
    const analyzer = new RekognitionImageAnalyzer(options, client);
    const signal = new AbortController().signal;
    const result = await analyzer.analyze({ image: await webp(), mediaType: 'image/webp' }, signal);

    expect(client.sent.map((s) => s.name)).toEqual([
      'DetectModerationLabelsCommand',
      'DetectTextCommand',
      'RecognizeCelebritiesCommand',
    ]);
    for (const sent of client.sent) {
      const bytes = (sent.input.Image as { Bytes: Uint8Array }).Bytes;
      expect(Buffer.from(bytes.subarray(0, 8))).toEqual(PNG_SIGNATURE);
      expect(sent.abortSignal).toBe(signal);
      // R-8: só a imagem (e MinConfidence na moderação). Nada mais.
      expect(Object.keys(sent.input).sort()).toEqual(
        sent.name === 'DetectModerationLabelsCommand' ? ['Image', 'MinConfidence'] : ['Image'],
      );
      expect(Object.keys(sent.input.Image as object)).toEqual(['Bytes']);
    }
    expect(client.sent[0].input.MinConfidence).toBe(50);
    const first = (client.sent[0].input.Image as { Bytes: Uint8Array }).Bytes;
    expect(client.sent.every((s) => (s.input.Image as { Bytes: Uint8Array }).Bytes === first)).toBe(
      true,
    );

    expect(result).toMatchObject({
      model: 'moderation=7.0;text=3.0',
      requestId: 'req-mod',
      raw: {
        moderation: {
          ModerationLabels: [{ Name: 'Alcohol', Confidence: 71.2, TaxonomyLevel: 1 }],
          ModerationModelVersion: '7.0',
        },
        text: { TextDetections: [{ DetectedText: 'Padaria', Type: 'LINE', Confidence: 99 }] },
        celebrities: { CelebrityFaces: [] },
      },
    });
    expect(JSON.stringify(result.raw)).not.toContain('$metadata');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('comandos são instâncias reais do SDK', async () => {
    const client = new FakeClient();
    const sentCommands: unknown[] = [];
    client.send = async (command, options) => {
      sentCommands.push(command);
      return FakeClient.prototype.send.call(client, command, options);
    };
    await new RekognitionImageAnalyzer(options, client).analyze(
      { image: await webp(), mediaType: 'image/webp' },
      new AbortController().signal,
    );
    expect(sentCommands[0]).toBeInstanceOf(DetectModerationLabelsCommand);
    expect(sentCommands[1]).toBeInstanceOf(DetectTextCommand);
    expect(sentCommands[2]).toBeInstanceOf(RecognizeCelebritiesCommand);
  });

  it('bytes que não são imagem → AnalyzerError internal sem chamar a API', async () => {
    const client = new FakeClient();
    const analyzer = new RekognitionImageAnalyzer(options, client);
    await expect(
      analyzer.analyze(
        { image: Buffer.from('não é webp'), mediaType: 'image/webp' },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'internal' });
    expect(client.sent).toHaveLength(0);
  });

  it.each([
    ['ThrottlingException', 'rate_limited'],
    ['ProvisionedThroughputExceededException', 'rate_limited'],
    ['InternalServerError', 'provider_unavailable'],
    ['AccessDeniedException', 'provider_rejected'],
    ['InvalidParameterException', 'provider_rejected'],
    ['InvalidImageFormatException', 'provider_rejected'],
    ['ImageTooLargeException', 'provider_rejected'],
    ['CredentialsProviderError', 'provider_rejected'],
    ['UnrecognizedClientException', 'provider_rejected'],
    ['ExpiredTokenException', 'provider_rejected'],
    ['AbortError', 'timeout'],
    ['Error', 'internal'],
  ] as const)('%s → %s; a mensagem não carrega a mensagem original', async (name, code) => {
    const client = new FakeClient();
    client.failures.set('DetectTextCommand', awsError(name));
    const analyzer = new RekognitionImageAnalyzer(options, client);
    const error = await analyzer
      .analyze({ image: await webp(), mediaType: 'image/webp' }, new AbortController().signal)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AnalyzerError);
    expect((error as AnalyzerError).code).toBe(code);
    expect((error as Error).message).not.toContain('arn:aws');
  });

  it('erro de rede (code ECONNRESET) e 5xx sem nome conhecido → provider_unavailable; signal abortado → timeout', () => {
    const live = new AbortController().signal;
    expect(classify(awsError('Error', { code: 'ECONNRESET' }), live).code).toBe(
      'provider_unavailable',
    );
    expect(classify(awsError('Error', { $metadata: { httpStatusCode: 503 } }), live).code).toBe(
      'provider_unavailable',
    );
    const aborted = new AbortController();
    aborted.abort();
    expect(classify(awsError('Error'), aborted.signal).code).toBe('timeout');
    expect(classify('string', live).code).toBe('internal');
  });

  it('cliente real é criado com a região e sem retentativas internas (maxAttempts 1)', async () => {
    const analyzer = new RekognitionImageAnalyzer({ ...options, profile: 'puoro' });
    const client = (
      analyzer as unknown as {
        client: { config: { maxAttempts: () => Promise<number>; region: () => Promise<string> } };
      }
    ).client;
    expect(await client.config.maxAttempts()).toBe(1);
    expect(await client.config.region()).toBe('us-east-1');
  });
});
