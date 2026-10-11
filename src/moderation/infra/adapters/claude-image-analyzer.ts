import Anthropic from '@anthropic-ai/sdk';
import { MODERATION_RESPONSE_JSON_SCHEMA } from '../../domain/contract';
import { AnalyzerError, type AnalyzerErrorCode } from '../../domain/errors';
import type {
  AnalyzeImageInput,
  AnalyzerResult,
  ImageAnalyzer,
} from '../../domain/ports/image-analyzer';
import { MODERATION_SYSTEM_PROMPT, buildUserText } from '../../domain/system-prompt';
import type { ModerationConfig } from '../config/moderation-config.factory';

/** Espaço de saída suficiente para o JSON do contrato (R-5). */
export const MAX_OUTPUT_TOKENS = 2048;

/** Subconjunto do cliente do SDK usado aqui (injetável nos testes). */
export interface MessagesClient {
  messages: {
    create(
      params: Anthropic.MessageCreateParamsNonStreaming,
      options?: { signal?: AbortSignal },
    ): Promise<Anthropic.Message>;
  };
}

/**
 * Adapter da Claude API via SDK oficial (spec sponsorship-image-moderation FR-04). Só traduz
 * protocolo: monta a requisição (prompt de sistema fixo cacheável, imagem base64, texto do local,
 * saída estruturada), devolve o conteúdo bruto e classifica falhas em {@link AnalyzerError}. A
 * requisição nunca leva nada além da imagem e do local (R-8); retentativas internas do SDK ficam
 * desligadas para que cada chamada conte como uma tentativa (R-5).
 */
export class ClaudeImageAnalyzer implements ImageAnalyzer {
  readonly name = 'claude' as const;
  private readonly client: MessagesClient;

  constructor(
    private readonly config: Pick<ModerationConfig, 'model' | 'effort' | 'timeoutMs' | 'apiKey'>,
    client?: MessagesClient,
  ) {
    this.client =
      client ??
      new Anthropic({
        apiKey: config.apiKey ?? undefined,
        maxRetries: 0,
        timeout: config.timeoutMs,
      });
  }

  async analyze(input: AnalyzeImageInput, signal: AbortSignal): Promise<AnalyzerResult> {
    const startedAt = Date.now();
    let message: Anthropic.Message;
    try {
      message = await this.client.messages.create(
        {
          model: this.config.model,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: [
            {
              type: 'text',
              text: MODERATION_SYSTEM_PROMPT,
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: input.mediaType,
                    data: input.image.toString('base64'),
                  },
                },
                { type: 'text', text: buildUserText(input.placement) },
              ],
            },
          ],
          output_config: {
            effort: this.config.effort,
            format: { type: 'json_schema', schema: { ...MODERATION_RESPONSE_JSON_SCHEMA } },
          },
        },
        { signal },
      );
    } catch (error) {
      throw new AnalyzerError(classify(error, signal), describe(error));
    }

    const latencyMs = Date.now() - startedAt;
    const requestId = (message as { _request_id?: string | null })._request_id ?? null;
    const base = { model: message.model, requestId, latencyMs };
    if (message.stop_reason === 'refusal') return { kind: 'refusal', ...base };
    const raw = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
    return {
      kind: 'response',
      raw,
      inputTokens: message.usage?.input_tokens ?? null,
      outputTokens: message.usage?.output_tokens ?? null,
      ...base,
    };
  }
}

/** Classe do SDK → código de falha (R-5). Checagens da mais específica para a mais genérica. */
export function classify(error: unknown, signal: AbortSignal): AnalyzerErrorCode {
  if (error instanceof Anthropic.RateLimitError) return 'rate_limited';
  if (error instanceof Anthropic.APIUserAbortError || signal.aborted) return 'timeout';
  if (error instanceof Anthropic.APIConnectionTimeoutError) return 'timeout';
  if (error instanceof Anthropic.APIConnectionError) return 'provider_unavailable';
  if (error instanceof Anthropic.InternalServerError) return 'provider_unavailable';
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError ||
    error instanceof Anthropic.NotFoundError ||
    error instanceof Anthropic.BadRequestError
  ) {
    return 'provider_rejected';
  }
  if (error instanceof Anthropic.APIError) {
    return error.status === 529 ? 'provider_unavailable' : 'provider_rejected';
  }
  return 'internal';
}

/** Mensagem curta para log: status e tipo, sem o corpo (que poderia ecoar dados) nem a chave. */
function describe(error: unknown): string {
  if (error instanceof Anthropic.APIError) {
    return `Claude API ${error.status ?? 'sem status'}: ${error.name}`;
  }
  return error instanceof Error ? error.name : 'erro desconhecido';
}
