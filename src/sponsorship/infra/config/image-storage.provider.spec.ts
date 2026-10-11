import { testConfig } from '../../application/__fakes__/fixtures';
import { LocalDiskImageStorage } from '../adapters/local-disk-image-storage';
import { S3ImageStorage } from '../adapters/s3-image-storage';
import { createImageStorage } from './image-storage.provider';

describe('createImageStorage — spec sponsorship-s3-storage FR-03 (AC-08)', () => {
  const env = { ...process.env };
  let logs: string[];
  const logger = { log: (m: string) => logs.push(m), warn: (m: string) => logs.push(m) };

  beforeEach(() => {
    logs = [];
    process.env.AWS_SECRET_ACCESS_KEY = 'segredo-de-teste';
  });
  afterAll(() => {
    process.env = env;
  });

  it('s3 → S3ImageStorage, com log de bucket e região sem credenciais', () => {
    const storage = createImageStorage(
      testConfig({
        storage: {
          kind: 's3',
          bucket: 'apuracaobrutal-prod-sponsorship-images',
          region: 'us-east-1',
          profile: null,
          endpoint: null,
          timeoutMs: 10_000,
        },
      }),
      logger,
    );
    expect(storage).toBeInstanceOf(S3ImageStorage);
    expect(logs).toEqual([
      'armazenamento de imagens: s3 bucket=apuracaobrutal-prod-sponsorship-images region=us-east-1',
    ]);
    expect(logs.join()).not.toContain('segredo-de-teste');
  });

  it('local → LocalDiskImageStorage', () => {
    const storage = createImageStorage(
      testConfig({ storage: { kind: 'local', dir: '/tmp/imagens' } }),
      logger,
    );
    expect(storage).toBeInstanceOf(LocalDiskImageStorage);
    expect(logs).toEqual(['armazenamento de imagens: local dir=/tmp/imagens']);
  });
});
