import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { fromIni } from '@aws-sdk/credential-providers';
import { createHash } from 'node:crypto';
import { StorageError, type StorageOperation } from '../../domain/errors';
import type { SponsorImageStorage } from '../../domain/ports/sponsor-image-storage';
import { assertImageKey } from './image-key';

export interface S3ImageStorageOptions {
  bucket: string;
  region: string;
  /** Profile do `~/.aws` (desenvolvimento); nulo → cadeia padrão do SDK (IAM role). */
  profile: string | null;
  /** S3 compatível com path-style (desenvolvimento); nulo → endpoint oficial. */
  endpoint: string | null;
  /** Timeout por tentativa de cada chamada. */
  timeoutMs: number;
  /** Objetos acima disso são tratados como ausentes (R-3). */
  maxBytes: number;
}

/** Subconjunto do cliente usado pelo adapter — injetável nos testes. */
export interface S3ClientLike {
  send(command: unknown): Promise<unknown>;
}

interface Logger {
  warn(message: string): void;
}

/** Corpo devolvido pelo `GetObject` no Node: stream com utilitários do SDK. */
interface ObjectBody {
  transformToByteArray(): Promise<Uint8Array>;
  destroy?(): void;
}

interface GetObjectResult {
  Body?: ObjectBody;
  ContentLength?: number;
}

/** Chave ausente (`GetObject` → `NoSuchKey`; `HeadObject` → `NotFound`) não é erro (R-3). */
const MISSING = new Set(['NoSuchKey', 'NotFound']);

/** Configuração do cliente (spec sponsorship-s3-storage FR-02, R-4). Exportada para os testes. */
export function s3ClientConfig(options: S3ImageStorageOptions): S3ClientConfig {
  return {
    region: options.region,
    // Operações idempotentes: o SDK repete com backoff (R-4).
    maxAttempts: 3,
    requestHandler: { requestTimeout: options.timeoutMs, connectionTimeout: options.timeoutMs },
    ...(options.profile ? { credentials: fromIni({ profile: options.profile }) } : {}),
    ...(options.endpoint ? { endpoint: options.endpoint, forcePathStyle: true } : {}),
  };
}

export function createS3Client(options: S3ImageStorageOptions): S3Client {
  return new S3Client(s3ClientConfig(options));
}

/**
 * Adapter S3 da porta de armazenamento (spec sponsorship-s3-storage FR-02). Só traduz protocolo:
 * um objeto `<uuid>.webp` por imagem na raiz do bucket, `Content-Type: image/webp`, checksum
 * SHA-256 no envio (R-2); chave ausente → `null`; qualquer outra falha → `StorageError` sem
 * credenciais na mensagem (R-3, R-4). Nenhuma URL do bucket sai daqui.
 */
export class S3ImageStorage implements SponsorImageStorage {
  private readonly client: S3ClientLike;

  constructor(
    private readonly options: S3ImageStorageOptions,
    client?: S3ClientLike,
    private readonly logger: Logger = { warn: () => undefined },
  ) {
    this.client = client ?? createS3Client(options);
  }

  async save(key: string, bytes: Buffer): Promise<void> {
    assertImageKey(key);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.options.bucket,
          Key: key,
          Body: bytes,
          ContentType: 'image/webp',
          ChecksumSHA256: createHash('sha256').update(bytes).digest('base64'),
        }),
      );
    } catch (error) {
      throw toStorageError('save', key, error);
    }
  }

  async read(key: string): Promise<Buffer | null> {
    assertImageKey(key);
    let result: GetObjectResult;
    try {
      result = (await this.client.send(
        new GetObjectCommand({ Bucket: this.options.bucket, Key: key }),
      )) as GetObjectResult;
    } catch (error) {
      if (MISSING.has(errorName(error))) return null;
      throw toStorageError('read', key, error);
    }
    if (!result.Body) throw new StorageError('read', key, { name: 'EmptyBody' });
    if ((result.ContentLength ?? 0) > this.options.maxBytes) {
      // Nenhuma imagem legítima passa do limite: não aloca o corpo (R-3).
      result.Body.destroy?.();
      this.logger.warn(
        `objeto ${key} tem ${result.ContentLength} bytes (> ${this.options.maxBytes}); tratado como ausente`,
      );
      return null;
    }
    try {
      return Buffer.from(await result.Body.transformToByteArray());
    } catch (error) {
      throw toStorageError('read', key, error);
    }
  }

  async remove(key: string): Promise<void> {
    assertImageKey(key);
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }));
    } catch (error) {
      throw toStorageError('remove', key, error);
    }
  }
}

function errorName(error: unknown): string {
  const { name, code } = (error ?? {}) as { name?: string; code?: string };
  return name && name !== 'Error' ? name : (code ?? name ?? 'UnknownError');
}

/** Só nome do erro e status HTTP: a mensagem original do SDK pode carregar cabeçalhos (R-4). */
function toStorageError(operation: StorageOperation, key: string, error: unknown): StorageError {
  const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  return new StorageError(operation, key, { name: errorName(error), status: status ?? null });
}
