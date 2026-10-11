import Anthropic from '@anthropic-ai/sdk';
import { AnalyzerError } from '../../domain/errors';
import { MODERATION_SYSTEM_PROMPT } from '../../domain/system-prompt';
import {
  ClaudeImageAnalyzer,
  MAX_OUTPUT_TOKENS,
  classify,
  type MessagesClient,
} from './claude-image-analyzer';

const KEY = 'sk-ant-test-key-0000';
const config = {
  model: 'claude-opus-5-5',
  effort: 'medium' as const,
  timeoutMs: 30_000,
  apiKey: KEY,
};
const input = {
  image: Buffer.from('RIFF....WEBP'),
  mediaType: 'image/webp' as const,
  placement: 'faixa central do fundo',
};

function message(overrides: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [{ type: 'text', text: '{"decision":"APPROVE"}', citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 1800,
      output_tokens: 90,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      cache_creation: null,
      server_tool_use: null,
      service_tier: null,
      inference_geo: null,
    } as Anthropic.Usage,
    ...overrides,
  } as Anthropic.Message;
}

function client(result: Anthropic.Message | Error) {
  const calls: {
    params: Anthropic.MessageCreateParamsNonStreaming;
    options?: { signal?: AbortSignal };
  }[] = [];
  const fake: MessagesClient = {
    messages: {
      create: async (params, options) => {
        calls.push({ params, options });
        if (result instanceof Error) throw result;
        return result;
      },
    },
  };
  return { fake, calls };
}

describe('ClaudeImageAnalyzer — spec sponsorship-image-moderation FR-04 (AC-15, AC-17)', () => {
  it('monta a requisição com prompt cacheável, imagem base64, local e saída estruturada', async () => {
    const reply = message();
    Object.defineProperty(reply, '_request_id', { value: 'req_abc', enumerable: false });
    const { fake, calls } = client(reply);
    const signal = new AbortController().signal;
    const result = await new ClaudeImageAnalyzer(config, fake).analyze(input, signal);

    expect(calls).toHaveLength(1);
    const { params, options } = calls[0];
    expect(options?.signal).toBe(signal);
    expect(params.model).toBe('claude-opus-5-5');
    expect(params.max_tokens).toBe(MAX_OUTPUT_TOKENS);
    expect(params.system).toEqual([
      { type: 'text', text: MODERATION_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ]);
    expect(params.messages).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/webp',
              data: input.image.toString('base64'),
            },
          },
          {
            type: 'text',
            text: 'Analise a imagem anexada, enviada para o espaço publicitário: faixa central do fundo. Responda só com o JSON do contrato.',
          },
        ],
      },
    ]);
    expect(params.output_config).toMatchObject({
      effort: 'medium',
      format: { type: 'json_schema', schema: { type: 'object', additionalProperties: false } },
    });
    // Nada além do prompt, imagem e local (R-8): nenhum campo do pedido ou do anunciante.
    const serialized = JSON.stringify(params.messages);
    expect(serialized).not.toMatch(/email|cpf|advertiser|amount|sponsorshipId|sk-ant/i);

    expect(result).toEqual({
      kind: 'response',
      raw: '{"decision":"APPROVE"}',
      model: 'claude-opus-5-5',
      requestId: 'req_abc',
      latencyMs: expect.any(Number),
      inputTokens: 1800,
      outputTokens: 90,
    });
  });

  it('stop_reason refusal → kind refusal', async () => {
    const { fake } = client(message({ stop_reason: 'refusal', content: [] }));
    const result = await new ClaudeImageAnalyzer(config, fake).analyze(
      input,
      new AbortController().signal,
    );
    expect(result).toMatchObject({ kind: 'refusal', model: 'claude-opus-5-5', requestId: null });
  });

  it('max_tokens devolve o texto parcial (o parser recusa depois)', async () => {
    const { fake } = client(
      message({
        stop_reason: 'max_tokens',
        content: [{ type: 'text', text: '{"decision":', citations: null }],
      }),
    );
    const result = await new ClaudeImageAnalyzer(config, fake).analyze(
      input,
      new AbortController().signal,
    );
    expect(result).toMatchObject({ kind: 'response', raw: '{"decision":' });
  });

  it.each([
    ['429', new Anthropic.RateLimitError(429, {}, 'rate', new Headers()), 'rate_limited'],
    [
      '500',
      new Anthropic.InternalServerError(500, {}, 'boom', new Headers()),
      'provider_unavailable',
    ],
    ['529', new Anthropic.APIError(529, {}, 'overloaded', new Headers()), 'provider_unavailable'],
    ['rede', new Anthropic.APIConnectionError({ message: 'ECONNRESET' }), 'provider_unavailable'],
    ['timeout do SDK', new Anthropic.APIConnectionTimeoutError(), 'timeout'],
    ['abort', new Anthropic.APIUserAbortError(), 'timeout'],
    [
      '401',
      new Anthropic.AuthenticationError(401, {}, 'bad key', new Headers()),
      'provider_rejected',
    ],
    ['403', new Anthropic.PermissionDeniedError(403, {}, 'no', new Headers()), 'provider_rejected'],
    ['404', new Anthropic.NotFoundError(404, {}, 'no model', new Headers()), 'provider_rejected'],
    ['400', new Anthropic.BadRequestError(400, {}, 'bad', new Headers()), 'provider_rejected'],
    ['outro', new Error('x'), 'internal'],
  ] as const)('erro %s → %s, sem a chave na mensagem', async (_, error, code) => {
    const { fake } = client(error);
    const promise = new ClaudeImageAnalyzer(config, fake).analyze(
      input,
      new AbortController().signal,
    );
    await expect(promise).rejects.toBeInstanceOf(AnalyzerError);
    const thrown = (await promise.catch((e) => e)) as AnalyzerError;
    expect(thrown.code).toBe(code);
    expect(thrown.message).not.toContain(KEY);
    expect(thrown.message).not.toContain('base64');
  });

  it('erro de rede com o sinal já abortado → timeout', () => {
    const controller = new AbortController();
    controller.abort();
    expect(
      classify(new Anthropic.APIConnectionError({ message: 'aborted' }), controller.signal),
    ).toBe('timeout');
  });
});
