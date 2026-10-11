import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import sharp = require('sharp');
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/config/configure-app';
import { createSwaggerDocument } from '../src/config/swagger';
import { FakeClock, testConfig } from '../src/sponsorship/application/__fakes__/fixtures';
import { InMemoryImageStorage } from '../src/sponsorship/application/__fakes__/in-memory-image-storage';
import { InMemorySponsorshipRepository } from '../src/sponsorship/application/__fakes__/in-memory-sponsorship-repository';
import { SPONSORSHIP_CLOCK } from '../src/sponsorship/domain/ports/clock';
import { SPONSOR_IMAGE_STORAGE } from '../src/sponsorship/domain/ports/sponsor-image-storage';
import { SPONSORSHIP_REPOSITORY } from '../src/sponsorship/domain/ports/sponsorship-repository';
import type { SponsorshipConfig } from '../src/sponsorship/domain/sponsorship-config';
import { SPONSORSHIP_CONFIG } from '../src/sponsorship/infra/config/sponsorship-config.factory';

const ORIGIN = 'http://localhost:3100';
const MIN = 60_000;
const NAME = 'Padaria Central Ltda';
const EMAIL = 'contato@padaria-central.com.br';

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#ff7a00' } });

interface Fixture {
  app: INestApplication;
  repository: InMemorySponsorshipRepository;
  storage: InMemoryImageStorage;
  clock: FakeClock;
}

async function createApp(config?: SponsorshipConfig): Promise<Fixture> {
  const repository = new InMemorySponsorshipRepository();
  const storage = new InMemoryImageStorage();
  const clock = new FakeClock();
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SPONSORSHIP_REPOSITORY)
    .useValue(repository)
    .overrideProvider(SPONSOR_IMAGE_STORAGE)
    .useValue(storage)
    .overrideProvider(SPONSORSHIP_CLOCK)
    .useValue(clock);
  if (config) builder = builder.overrideProvider(SPONSORSHIP_CONFIG).useValue(config);
  const app = (await builder.compile()).createNestApplication();
  configureApp(app);
  await app.init();
  return { app, repository, storage, clock };
}

describe('Sponsorships (e2e) — specs/sponsorships', () => {
  const env = { ...process.env };
  let f: Fixture;
  let png: Buffer;

  const post = (
    fields: Record<string, string>,
    image: Buffer | null = png,
    filename = 'logo.png',
  ) => {
    const req = request(f.app.getHttpServer()).post('/sponsorships').set('Origin', ORIGIN);
    for (const [key, value] of Object.entries(fields)) req.field(key, value);
    if (image) req.attach('image', image, filename);
    return req;
  };
  const validFields = (overrides: Record<string, string> = {}) => ({
    slot: 'center',
    minutes: '2',
    advertiserName: NAME,
    email: EMAIL,
    acceptTerms: 'true',
    ...overrides,
  });
  const createOrder = async (overrides: Record<string, string> = {}) =>
    (await post(validFields(overrides)).expect(201)).body as { id: string };
  const pay = (id: string) =>
    request(f.app.getHttpServer()).post(`/sponsorships/${id}/simulated-payment`);

  beforeAll(async () => {
    Logger.overrideLogger(false);
    delete process.env.CORS_ORIGINS;
    process.env.SPONSORSHIP_IMAGE_MAX_BYTES = '200000';
    process.env.SPONSORSHIP_CREATE_LIMIT_PER_HOUR = '1000';
    png = await solid(400, 200).png().toBuffer();
    f = await createApp();
  });

  afterAll(async () => {
    process.env = env;
    await f.app.close();
  });

  describe('POST /sponsorships', () => {
    it('cria pending_payment com preço congelado e TTL, sem dados pessoais (AC-05, AC-04)', async () => {
      const res = await post(validFields()).expect(201);
      expect(res.body).toEqual({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        slot: 'center',
        minutes: 2,
        unitPriceCents: 300_000,
        amountCents: 600_000,
        status: 'pending_payment',
        paymentExpiresAt: '2026-10-25T23:30:00.000Z',
        payment: { gateway: 'simulated' },
      });
      expect(JSON.stringify(res.body)).not.toMatch(/Padaria|contato@/);
      expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);

      const stored = f.storage.files.get(`${res.body.id}.webp`)!;
      expect(await sharp(stored).metadata()).toMatchObject({ format: 'webp', width: 400 });
    });

    it.each([
      [{ slot: 'roof' }, 'invalid_slot'],
      [{ minutes: '0' }, 'invalid_minutes'],
      [{ minutes: '61' }, 'invalid_minutes'],
      [{ minutes: '2.5' }, 'invalid_minutes'],
      [{ advertiserName: 'A' }, 'invalid_advertiser'],
      [{ email: 'nao-e-email' }, 'invalid_email'],
      [{ acceptTerms: 'false' }, 'terms_not_accepted'],
    ])('%j → 400 %s (AC-02, AC-04)', async (override, code) => {
      const res = await post(validFields(override)).expect(400);
      expect(res.body).toEqual({ code });
    });

    it('sem minutos → invalid_minutes (AC-02)', async () => {
      const fields: Record<string, string> = validFields();
      delete fields.minutes;
      expect((await post(fields).expect(400)).body).toEqual({ code: 'invalid_minutes' });
    });

    it('aceita JPEG e WebP (AC-03)', async () => {
      await post(validFields(), await solid(100, 100).jpeg().toBuffer(), 'a.jpg').expect(201);
      await post(validFields(), await solid(100, 100).webp().toBuffer(), 'a.webp').expect(201);
    });

    it.each([
      ['sem imagem', null],
      ['SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>')],
      ['GIF', Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00')],
      ['texto com extensão .png', Buffer.from('isto não é uma imagem')],
    ])('%s → 400 invalid_image (AC-03)', async (_label, image) => {
      expect((await post(validFields(), image).expect(400)).body).toEqual({
        code: 'invalid_image',
      });
    });

    it('PNG corrompido e imagem pequena demais → invalid_image (AC-03)', async () => {
      expect((await post(validFields(), png.subarray(0, 40)).expect(400)).body.code).toBe(
        'invalid_image',
      );
      const tiny = await solid(32, 32).png().toBuffer();
      expect((await post(validFields(), tiny).expect(400)).body.code).toBe('invalid_image');
    });

    it('acima do limite → 400 image_too_large, cortado pelo parser (AC-03)', async () => {
      const noise = await sharp(randomBytes(400 * 400 * 3), {
        raw: { width: 400, height: 400, channels: 3 },
      })
        .png()
        .toBuffer();
      expect(noise.length).toBeGreaterThan(200_000);
      expect((await post(validFields(), noise).expect(400)).body).toEqual({
        code: 'image_too_large',
      });
    });

    it('GET devolve o pedido com o valor congelado na criação (AC-05)', async () => {
      const { id } = await createOrder({ slot: 'floor', minutes: '1' });
      const res = await request(f.app.getHttpServer()).get(`/sponsorships/${id}`).expect(200);
      expect(res.body.amountCents).toBe(500_000);
    });
  });

  describe('POST /sponsorships/:id/simulated-payment', () => {
    it('agenda, é idempotente e o GET reflete a confirmação (AC-06, AC-08)', async () => {
      const { id } = await createOrder({ slot: 'glove_red', minutes: '3' });
      const first = await pay(id).expect(200);
      expect(first.body).toMatchObject({
        id,
        status: 'scheduled',
        startsInMinutes: 1,
        startsAt: '2026-10-25T23:01:00.000Z',
        endsAt: '2026-10-25T23:04:00.000Z',
      });
      const second = await pay(id).expect(200);
      expect(second.body).toEqual(first.body);
      const get = await request(f.app.getHttpServer()).get(`/sponsorships/${id}`).expect(200);
      expect(get.body).toEqual(first.body);
      expect(JSON.stringify(get.body)).not.toMatch(/Padaria|contato@/);
    });

    it('vencido → 409 expired e fica expired (AC-08)', async () => {
      const { id } = await createOrder();
      f.clock.advance(30 * MIN);
      expect((await pay(id).expect(409)).body).toEqual({ code: 'expired' });
      f.clock.advance(-30 * MIN);
      const get = await request(f.app.getHttpServer()).get(`/sponsorships/${id}`).expect(200);
      expect(get.body.status).toBe('expired');
    });

    it('inexistente ou malformado → 404 (AC-08)', async () => {
      await pay('3f0e8a52-6c1e-4f0a-9d3b-2a1b4c5d6e7f').expect(404);
      await pay('not-a-uuid').expect(404);
      await request(f.app.getHttpServer()).get('/sponsorships/../etc').expect(404);
    });
  });

  describe('agenda e imagem', () => {
    it('schedule só traz scheduled da janela; imagem só de scheduled (AC-10)', async () => {
      f.repository.rows.clear();
      const pending = await createOrder({ slot: 'side_left' });
      const a = await createOrder({ slot: 'side_right', minutes: '5' });
      const b = await createOrder({ slot: 'side_right', minutes: '5' });
      const c = await createOrder({ slot: 'side_right', minutes: '5' });
      for (const { id } of [a, b, c]) await pay(id).expect(200);

      const res = await request(f.app.getHttpServer())
        .get('/sponsorships/schedule')
        .set('Origin', ORIGIN)
        .expect(200);
      expect(res.body.serverTime).toBe('2026-10-25T23:00:00.000Z');
      expect(res.body.items.map((item: { sponsorshipId: string }) => item.sponsorshipId)).toEqual([
        a.id,
        b.id,
      ]);
      expect(res.body.items[0]).toEqual({
        slot: 'side_right',
        sponsorshipId: a.id,
        imageUrl: expect.stringMatching(
          new RegExp(`^http://127\\.0\\.0\\.1:\\d+/sponsorships/${a.id}/image$`),
        ),
        startsAt: '2026-10-25T23:01:00.000Z',
        endsAt: '2026-10-25T23:06:00.000Z',
      });

      const image = await request(f.app.getHttpServer())
        .get(`/sponsorships/${a.id}/image`)
        .set('Origin', ORIGIN)
        .expect(200);
      expect(image.headers['content-type']).toBe('image/webp');
      expect(image.headers['x-content-type-options']).toBe('nosniff');
      expect(image.headers['cache-control']).toBe('public, max-age=86400, immutable');
      expect(image.headers['access-control-allow-origin']).toBe(ORIGIN);

      await request(f.app.getHttpServer()).get(`/sponsorships/${pending.id}/image`).expect(404);
    });

    it('oferta traz os seis locais com preço e fila (FR-03)', async () => {
      const res = await request(f.app.getHttpServer()).get('/sponsorships/offer').expect(200);
      expect(res.body.available).toBe(true);
      expect(res.body.maxMinutes).toBe(60);
      expect(res.body.slots).toHaveLength(6);
      expect(res.body.slots[0]).toEqual({
        slot: 'side_left',
        unitPriceCents: 100_000,
        queueEndsAt: null,
      });
    });
  });

  it('documento OpenAPI tem as 6 rotas com a tag sponsorships (AC-13)', () => {
    const doc = createSwaggerDocument(f.app);
    const routes = Object.entries(doc.paths)
      .filter(([path]) => path.startsWith('/sponsorships'))
      .flatMap(([path, item]) =>
        Object.entries(item)
          .filter(([, op]) => (op as { tags?: string[] }).tags?.includes('sponsorships'))
          .map(([method]) => `${method.toUpperCase()} ${path}`),
      );
    expect(routes.sort()).toEqual(
      [
        'GET /sponsorships/offer',
        'GET /sponsorships/schedule',
        'POST /sponsorships',
        'POST /sponsorships/{id}/simulated-payment',
        'GET /sponsorships/{id}',
        'GET /sponsorships/{id}/image',
      ].sort(),
    );
  });
});

describe('Sponsorships em produção com gateway simulado (e2e, AC-09)', () => {
  let f: Fixture;
  beforeAll(async () => {
    Logger.overrideLogger(false);
    f = await createApp(testConfig({ production: true }));
  });
  afterAll(() => f.app.close());

  it('oferta indisponível, criar e confirmar → 503, agenda 200', async () => {
    const server = f.app.getHttpServer();
    expect((await request(server).get('/sponsorships/offer').expect(200)).body.available).toBe(
      false,
    );
    const png = await solid(100, 100).png().toBuffer();
    await request(server)
      .post('/sponsorships')
      .field('slot', 'center')
      .field('minutes', '1')
      .field('advertiserName', 'Ana Souza')
      .field('email', 'ana@exemplo.com')
      .field('acceptTerms', 'true')
      .attach('image', png, 'a.png')
      .expect(503);
    await request(server)
      .post('/sponsorships/3f0e8a52-6c1e-4f0a-9d3b-2a1b4c5d6e7f/simulated-payment')
      .expect(503);
    await request(server).get('/sponsorships/schedule').expect(200);
  });
});

describe('Sponsorships — limite de criação por IP (e2e, AC-12)', () => {
  const env = { ...process.env };
  let f: Fixture;
  beforeAll(async () => {
    Logger.overrideLogger(false);
    process.env.SPONSORSHIP_CREATE_LIMIT_PER_HOUR = '3';
    f = await createApp();
  });
  afterAll(async () => {
    process.env = env;
    await f.app.close();
  });

  it('acima do limite → 429; outras rotas seguem livres', async () => {
    const server = f.app.getHttpServer();
    const send = () => request(server).post('/sponsorships').field('slot', 'roof');
    for (let i = 0; i < 3; i++) await send().expect(400);
    await send().expect(429);
    await request(server).get('/sponsorships/offer').expect(200);
  });
});
