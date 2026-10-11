import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { StorageError } from '../../domain/errors';
import {
  S3ImageStorage,
  createS3Client,
  s3ClientConfig,
  type S3ImageStorageOptions,
} from './s3-image-storage';

const KEY = '3f0e8a52-6c1e-4f0a-9d3b-2a1b4c5d6e7f.webp';
const SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';

const options = (overrides: Partial<S3ImageStorageOptions> = {}): S3ImageStorageOptions => ({
  bucket: 'apuracaobrutal-prod-sponsorship-images',
  region: 'us-east-1',
  profile: null,
  endpoint: null,
  timeoutMs: 10_000,
  maxBytes: 2_097_152,
  ...overrides,
});

class AwsError extends Error {
  $metadata: { httpStatusCode?: number };
  constructor(name: string, status?: number) {
    super(`${name}: x-amz-security-token=${SECRET}`);
    this.name = name;
    this.$metadata = { httpStatusCode: status };
  }
}

/** Cliente falso: guarda os comandos e responde/lança o que o teste mandar. */
class FakeClient {
  readonly commands: unknown[] = [];
  response: unknown = {};
  error: unknown = null;
  async send(command: unknown): Promise<unknown> {
    this.commands.push(command);
    if (this.error) throw this.error;
    return this.response;
  }
  last<T>(): T {
    return this.commands[this.commands.length - 1] as T;
  }
}

function body(bytes: Buffer) {
  const calls = { transform: 0, destroy: 0 };
  return {
    calls,
    stream: {
      transformToByteArray: async () => {
        calls.transform++;
        return new Uint8Array(bytes);
      },
      destroy: () => {
        calls.destroy++;
      },
    },
  };
}

describe('S3ImageStorage — spec sponsorship-s3-storage FR-02', () => {
  const env = { ...process.env };
  let client: FakeClient;
  let warnings: string[];
  let storage: S3ImageStorage;

  beforeEach(() => {
    process.env.AWS_SECRET_ACCESS_KEY = SECRET;
    client = new FakeClient();
    warnings = [];
    storage = new S3ImageStorage(options(), client, { warn: (m) => warnings.push(m) });
  });
  afterAll(() => {
    process.env = env;
  });

  it('save envia PutObject com bucket, chave, corpo, content-type e checksum SHA-256 (AC-02)', async () => {
    const bytes = Buffer.from('RIFF....WEBP');
    await storage.save(KEY, bytes);
    const command = client.last<PutObjectCommand>();
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toEqual({
      Bucket: 'apuracaobrutal-prod-sponsorship-images',
      Key: KEY,
      Body: bytes,
      ContentType: 'image/webp',
      ChecksumSHA256: createHash('sha256').update(bytes).digest('base64'),
    });
    expect(command.input).not.toHaveProperty('ACL');
    expect(command.input).not.toHaveProperty('Metadata');
  });

  it('read devolve os bytes do corpo (AC-03)', async () => {
    const { stream } = body(Buffer.from('abc'));
    client.response = { Body: stream, ContentLength: 3 };
    expect((await storage.read(KEY))?.toString()).toBe('abc');
    const command = client.last<GetObjectCommand>();
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(command.input).toEqual({ Bucket: 'apuracaobrutal-prod-sponsorship-images', Key: KEY });
  });

  it.each(['NoSuchKey', 'NotFound'])('read com %s → null (AC-03)', async (name) => {
    client.error = new AwsError(name, 404);
    expect(await storage.read(KEY)).toBeNull();
  });

  it('read de objeto acima do limite → null com aviso, sem consumir o corpo (AC-03, R-3)', async () => {
    const { stream, calls } = body(Buffer.alloc(10));
    client.response = { Body: stream, ContentLength: 2_097_153 };
    expect(await storage.read(KEY)).toBeNull();
    expect(calls.transform).toBe(0);
    expect(calls.destroy).toBe(1);
    expect(warnings).toEqual([expect.stringContaining(`objeto ${KEY} tem 2097153 bytes`)]);
  });

  it('read sem corpo → StorageError', async () => {
    client.response = { ContentLength: 3 };
    await expect(storage.read(KEY)).rejects.toBeInstanceOf(StorageError);
  });

  it('remove envia DeleteObject e resolve mesmo sem o objeto (AC-04)', async () => {
    client.response = { DeleteMarker: false };
    await expect(storage.remove(KEY)).resolves.toBeUndefined();
    const command = client.last<DeleteObjectCommand>();
    expect(command).toBeInstanceOf(DeleteObjectCommand);
    expect(command.input).toEqual({ Bucket: 'apuracaobrutal-prod-sponsorship-images', Key: KEY });
  });

  it.each(['../x.webp', 'a.png', '', `${KEY}/..`])(
    'chave %p é recusada sem chamar o cliente, nos três métodos (AC-05)',
    async (key) => {
      await expect(storage.save(key, Buffer.from('a'))).rejects.toThrow('chave de imagem inválida');
      await expect(storage.read(key)).rejects.toThrow('chave de imagem inválida');
      await expect(storage.remove(key)).rejects.toThrow('chave de imagem inválida');
      expect(client.commands).toHaveLength(0);
    },
  );

  it.each([
    ['AccessDenied', new AwsError('AccessDenied', 403), 'AccessDenied', 403],
    [
      'rede',
      Object.assign(new Error(`connect ${SECRET}`), { code: 'ECONNRESET' }),
      'ECONNRESET',
      null,
    ],
    ['timeout', new AwsError('TimeoutError'), 'TimeoutError', null],
    ['SlowDown após as tentativas', new AwsError('SlowDown', 503), 'SlowDown', 503],
    ['credenciais', new AwsError('CredentialsProviderError'), 'CredentialsProviderError', null],
  ])(
    '%s → StorageError sem credenciais na mensagem (AC-06, R-4)',
    async (_l, error, name, status) => {
      client.error = error;
      const bytes = Buffer.from('imagem-secreta');
      for (const call of [
        () => storage.save(KEY, bytes),
        () => storage.read(KEY),
        () => storage.remove(KEY),
      ]) {
        const thrown = await call().catch((e: unknown) => e);
        expect(thrown).toBeInstanceOf(StorageError);
        const storageError = thrown as StorageError;
        expect(storageError.code).toBe('storage_error');
        expect(storageError.cause).toEqual({ name, status });
        expect(storageError.message).toContain(KEY);
        expect(storageError.message).not.toContain(SECRET);
        expect(storageError.message).not.toContain('imagem-secreta');
      }
    },
  );

  describe('cliente (AC-07, R-4)', () => {
    it('região, 3 tentativas, timeout; sem profile nem endpoint por padrão', async () => {
      const config = s3ClientConfig(options({ timeoutMs: 2_500 }));
      expect(config).toEqual({
        region: 'us-east-1',
        maxAttempts: 3,
        requestHandler: { requestTimeout: 2_500, connectionTimeout: 2_500 },
      });
      const client = createS3Client(options({ timeoutMs: 2_500 }));
      expect(client).toBeInstanceOf(S3Client);
      expect(await client.config.region()).toBe('us-east-1');
      expect(await client.config.maxAttempts()).toBe(3);
      expect(await client.config.forcePathStyle).toBe(false);
      client.destroy();
    });

    it('profile → credentials do ~/.aws; endpoint → path-style', async () => {
      const config = s3ClientConfig(
        options({ profile: 'puoro', endpoint: 'http://localhost:9000' }),
      );
      expect(config.credentials).toEqual(expect.any(Function));
      expect(config.endpoint).toBe('http://localhost:9000');
      expect(config.forcePathStyle).toBe(true);
      const client = createS3Client(options({ endpoint: 'http://localhost:9000' }));
      expect(client.config.forcePathStyle).toBe(true);
      const endpoint = await client.config.endpoint?.();
      expect(endpoint).toMatchObject({ hostname: 'localhost', port: 9000, protocol: 'http:' });
      client.destroy();
    });
  });
});
