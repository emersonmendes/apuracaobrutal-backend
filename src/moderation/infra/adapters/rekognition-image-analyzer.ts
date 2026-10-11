import {
  DetectModerationLabelsCommand,
  DetectTextCommand,
  RecognizeCelebritiesCommand,
  RekognitionClient,
} from '@aws-sdk/client-rekognition';
import { fromIni } from '@aws-sdk/credential-providers';
import sharp = require('sharp');
import { AnalyzerError, type AnalyzerErrorCode } from '../../domain/errors';
import type {
  AnalyzeImageInput,
  AnalyzerResult,
  ImageAnalyzer,
} from '../../domain/ports/image-analyzer';

/** `MinConfidence` fixo (R-3): o limiar de decisão é do domínio; rótulos de 50 ao limiar ficam na auditoria. */
export const REKOGNITION_MIN_CONFIDENCE = 50;

export interface RekognitionAnalyzerOptions {
  region: string;
  /** Profile do `~/.aws` (desenvolvimento); nulo → cadeia padrão do SDK (env, IAM role). */
  profile: string | null;
  timeoutMs: number;
}

/** Subconjunto do cliente usado pelo adapter — injetável nos testes. */
export interface RekognitionClientLike {
  send(command: unknown, options?: { abortSignal?: AbortSignal }): Promise<unknown>;
}

const THROTTLING = new Set(['ThrottlingException', 'ProvisionedThroughputExceededException']);
const REJECTED = new Set([
  'AccessDeniedException',
  'InvalidParameterException',
  'InvalidImageFormatException',
  'ImageTooLargeException',
  'CredentialsProviderError',
  'UnrecognizedClientException',
  'ExpiredTokenException',
  'InvalidSignatureException',
  'IncompleteSignatureException',
  'ResourceNotFoundException',
]);
const NETWORK_CODES = new Set([
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'EPIPE',
]);

/**
 * Adapter do Amazon Rekognition (spec sponsorship-image-moderation FR-04). Só traduz protocolo:
 * converte o WebP em PNG em memória (R-6), dispara `DetectModerationLabels`, `DetectText` e
 * `RecognizeCelebrities` em paralelo sob o mesmo `AbortSignal`, classifica falhas em
 * {@link AnalyzerError} e devolve as respostas sem interpretar. Envia só os bytes da imagem (R-8).
 */
export class RekognitionImageAnalyzer implements ImageAnalyzer {
  readonly name = 'rekognition' as const;
  private readonly client: RekognitionClientLike;

  constructor(
    private readonly options: RekognitionAnalyzerOptions,
    client?: RekognitionClientLike,
  ) {
    this.client =
      client ??
      new RekognitionClient({
        region: options.region,
        // Cada tentativa conta (R-5): sem retentativas internas do SDK.
        maxAttempts: 1,
        ...(options.profile ? { credentials: fromIni({ profile: options.profile }) } : {}),
      });
  }

  async analyze(input: AnalyzeImageInput, signal: AbortSignal): Promise<AnalyzerResult> {
    const startedAt = Date.now();
    let png: Buffer;
    try {
      // Derivada em memória, pixel a pixel, sem redimensionar; nada é gravado (R-6).
      png = await sharp(input.image).png().toBuffer();
    } catch (error) {
      // A mensagem do sharp descreve o formato, nunca a imagem nem credenciais (R-8).
      const detail = error instanceof Error ? error.message : String(error);
      throw new AnalyzerError('internal', `internal: conversão WebP → PNG falhou (${detail})`);
    }
    if (signal.aborted) throw new AnalyzerError('timeout');

    const Bytes = new Uint8Array(png.buffer, png.byteOffset, png.byteLength);
    const send = (command: unknown) => this.client.send(command, { abortSignal: signal });
    let moderation: Record<string, unknown>;
    let text: Record<string, unknown>;
    let celebrities: Record<string, unknown>;
    try {
      [moderation, text, celebrities] = (await Promise.all([
        send(
          new DetectModerationLabelsCommand({
            Image: { Bytes },
            MinConfidence: REKOGNITION_MIN_CONFIDENCE,
          }),
        ),
        send(new DetectTextCommand({ Image: { Bytes } })),
        send(new RecognizeCelebritiesCommand({ Image: { Bytes } })),
      ])) as Record<string, unknown>[];
    } catch (error) {
      throw classify(error, signal);
    }

    const requestId = metadataRequestId(moderation);
    return {
      raw: {
        moderation: stripMetadata(moderation),
        text: stripMetadata(text),
        celebrities: stripMetadata(celebrities),
      },
      model: `moderation=${versionOf(moderation, 'ModerationModelVersion')};text=${versionOf(text, 'TextModelVersion')}`,
      requestId,
      latencyMs: Date.now() - startedAt,
    };
  }
}

function versionOf(response: Record<string, unknown>, field: string): string {
  const value = response[field];
  return typeof value === 'string' && value !== '' ? value : '?';
}

function metadataRequestId(response: Record<string, unknown>): string | null {
  const metadata = response.$metadata;
  if (typeof metadata !== 'object' || metadata === null) return null;
  const id = (metadata as { requestId?: unknown }).requestId;
  return typeof id === 'string' ? id : null;
}

function stripMetadata(response: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(response).filter(([key]) => key !== '$metadata'));
}

/**
 * Classifica a falha (R-5). A mensagem leva só o código e o nome do erro — nunca a mensagem
 * original do SDK, que pode conter ARN, conta ou credenciais (R-8).
 */
export function classify(error: unknown, signal: AbortSignal): AnalyzerError {
  if (error instanceof AnalyzerError) return error;
  const name =
    typeof error === 'object' && error !== null
      ? String((error as { name?: unknown }).name ?? '')
      : '';
  const code =
    typeof error === 'object' && error !== null
      ? String((error as { code?: unknown }).code ?? '')
      : '';
  const kind = ((): AnalyzerErrorCode => {
    if (name === 'AbortError' || name === 'TimeoutError' || signal.aborted) return 'timeout';
    if (THROTTLING.has(name)) return 'rate_limited';
    if (REJECTED.has(name)) return 'provider_rejected';
    if (name === 'InternalServerError' || name === 'ServiceUnavailable')
      return 'provider_unavailable';
    if (NETWORK_CODES.has(code) || NETWORK_CODES.has(name)) return 'provider_unavailable';
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (typeof status === 'number' && status >= 500) return 'provider_unavailable';
    return 'internal';
  })();
  return new AnalyzerError(kind, `${kind}: ${name || code || 'erro desconhecido'}`);
}
