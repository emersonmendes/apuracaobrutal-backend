// Pagamento real via Asaas (e2e) — specs/asaas-payment AC-01, AC-03, AC-04, AC-05, AC-06, AC-08,
// AC-11. Gateway falso injetado no lugar do adapter real; nada sai para a rede.
import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import sharp = require('sharp');
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/config/configure-app';
import { createSwaggerDocument } from '../src/config/swagger';
import { FakePaymentGateway } from '../src/sponsorship/application/__fakes__/fake-payment-gateway';
import {
  FakeClock,
  TEST_CPF,
  asaasTestConfig,
} from '../src/sponsorship/application/__fakes__/fixtures';
import { InMemoryImageStorage } from '../src/sponsorship/application/__fakes__/in-memory-image-storage';
import { InMemorySponsorshipRepository } from '../src/sponsorship/application/__fakes__/in-memory-sponsorship-repository';
import { SPONSORSHIP_CLOCK } from '../src/sponsorship/domain/ports/clock';
import { PAYMENT_GATEWAY } from '../src/sponsorship/domain/ports/payment-gateway';
import { SPONSOR_IMAGE_STORAGE } from '../src/sponsorship/domain/ports/sponsor-image-storage';
import { SPONSORSHIP_REPOSITORY } from '../src/sponsorship/domain/ports/sponsorship-repository';
import { SPONSORSHIP_CONFIG } from '../src/sponsorship/infra/config/sponsorship-config.factory';

const MIN = 60_000;
const TOKEN = asaasTestConfig().asaas!.webhookToken;
const NAME = 'Padaria Central Ltda';
const EMAIL = 'contato@padaria-central.com.br';

describe('Asaas (e2e) — specs/asaas-payment', () => {
  let app: INestApplication;
  let png: Buffer;
  const repository = new InMemorySponsorshipRepository();
  // A moderação já aprovou (o gate é coberto em sponsorships.e2e-spec e abaixo).
  repository.autoApprove = true;
  const gateway = new FakePaymentGateway('asaas');
  const clock = new FakeClock(new Date('2026-10-20T15:00:00.000Z'));

  const server = () => app.getHttpServer();
  const post = (fields: Record<string, string> = {}) =>
    request(server())
      .post('/sponsorships')
      .field({
        slot: 'side_left',
        minutes: '2',
        advertiserName: NAME,
        email: EMAIL,
        cpfCnpj: '529.982.247-25',
        acceptTerms: 'true',
        ...fields,
      })
      .attach('image', png, 'logo.png');
  const createOrder = async () =>
    (await post().expect(201)).body as { id: string; amountCents: number };
  const webhook = (body: unknown, token: string | null = TOKEN) => {
    const req = request(server()).post('/webhooks/asaas');
    return (token === null ? req : req.set('asaas-access-token', token)).send(body as object);
  };
  const paidEvent = (
    order: { id: string; amountCents: number },
    overrides: Record<string, unknown> = {},
  ) => ({
    id: `evt_${order.id}_${overrides.event ?? 'PAYMENT_RECEIVED'}`,
    event: 'PAYMENT_RECEIVED',
    payment: {
      id: `pay_${order.id}`,
      externalReference: order.id,
      value: order.amountCents / 100,
      billingType: 'PIX',
      status: 'RECEIVED',
    },
    ...overrides,
  });

  beforeAll(async () => {
    Logger.overrideLogger(false);
    delete process.env.CORS_ORIGINS;
    process.env.SPONSORSHIP_CREATE_LIMIT_PER_HOUR = '1000';
    png = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#ff7a00' } })
      .png()
      .toBuffer();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SPONSORSHIP_REPOSITORY)
      .useValue(repository)
      .overrideProvider(SPONSOR_IMAGE_STORAGE)
      .useValue(new InMemoryImageStorage())
      .overrideProvider(SPONSORSHIP_CLOCK)
      .useValue(clock)
      .overrideProvider(SPONSORSHIP_CONFIG)
      .useValue(asaasTestConfig({ createLimitPerHour: 1000 }))
      .overrideProvider(PAYMENT_GATEWAY)
      .useValue(gateway)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    delete process.env.SPONSORSHIP_CREATE_LIMIT_PER_HOUR;
    await app.close();
  });

  it('oferta informa gateway, sandbox e formas; compra disponível (AC-11)', async () => {
    const res = await request(server()).get('/sponsorships/offer').expect(200);
    expect(res.body.available).toBe(true);
    expect(res.body.payment).toEqual({
      gateway: 'asaas',
      sandbox: true,
      methods: ['pix', 'credit_card'],
    });
  });

  it('POST exige CPF/CNPJ válido, na ordem depois do e-mail (AC-01)', async () => {
    expect((await post({ cpfCnpj: '529.982.247-26' }).expect(400)).body).toEqual({
      code: 'invalid_cpf_cnpj',
    });
    expect((await post({ cpfCnpj: '' }).expect(400)).body).toEqual({ code: 'invalid_cpf_cnpj' });
    expect((await post({ email: 'x', cpfCnpj: 'y' }).expect(400)).body).toEqual({
      code: 'invalid_email',
    });
    expect((await post({ cpfCnpj: 'y', acceptTerms: 'false' }).expect(400)).body).toEqual({
      code: 'invalid_cpf_cnpj',
    });
  });

  it('POST cria a cobrança com o pagador e nunca expõe CPF/CNPJ (AC-03)', async () => {
    const res = await post().expect(201);
    expect(res.body.payment).toEqual({
      gateway: 'asaas',
      sandbox: true,
      method: null,
      refund: null,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/Padaria|contato@|52998224725|529\.982/);
    const charge = gateway.charges.find((c) => c.sponsorshipId === res.body.id)!;
    expect(charge).toMatchObject({
      amountCents: 1_000,
      dueDate: '2026-10-20',
      payer: { name: NAME, email: EMAIL, cpfCnpj: TEST_CPF },
    });
    expect(repository.rows.get(res.body.id)).toMatchObject({
      cpfCnpj: TEST_CPF,
      chargeId: `pay_${res.body.id}`,
      invoiceUrl: `https://sandbox.asaas.com/i/${res.body.id}`,
    });
  });

  it('falha do gateway → 502 gateway_error e nada gravado (AC-03)', async () => {
    gateway.failNext.add('createCharge');
    const before = repository.rows.size;
    expect((await post().expect(502)).body).toEqual({ code: 'gateway_error' });
    expect(repository.rows.size).toBe(before);
  });

  it('GET /:id/payment devolve as instruções do pedido pendente (AC-04)', async () => {
    const order = await createOrder();
    const res = await request(server()).get(`/sponsorships/${order.id}/payment`).expect(200);
    expect(res.body).toEqual({
      gateway: 'asaas',
      sandbox: true,
      expiresAt: '2026-10-20T15:30:00.000Z',
      pix: { qrCodeImage: 'iVBORw0KGgoFAKE=', payload: `00020126FAKEpay_${order.id}6304ABCD` },
      card: { invoiceUrl: `https://sandbox.asaas.com/i/${order.id}` },
    });
    await request(server())
      .get('/sponsorships/3f0e8a52-6c1e-4f0a-9d3b-2a1b4c5d6e7f/payment')
      .expect(404);
    await request(server()).get('/sponsorships/not-a-uuid/payment').expect(404);
  });

  it('simulated-payment não existe com Asaas (AC-11)', async () => {
    const order = await createOrder();
    await request(server()).post(`/sponsorships/${order.id}/simulated-payment`).expect(404);
  });

  describe('POST /webhooks/asaas (AC-05, AC-06)', () => {
    it('sem token ou com token errado → 401 e nada gravado', async () => {
      const order = await createOrder();
      expect((await webhook(paidEvent(order), null).expect(401)).body).toEqual({
        code: 'unauthorized',
      });
      expect((await webhook(paidEvent(order), 'errado').expect(401)).body).toEqual({
        code: 'unauthorized',
      });
      expect((await webhook(paidEvent(order), `${TOKEN}x`).expect(401)).body).toEqual({
        code: 'unauthorized',
      });
      expect(repository.events.size).toBe(0);
      expect(repository.rows.get(order.id)!.status).toBe('pending_payment');
    });

    it.each([
      ['sem id', { event: 'PAYMENT_RECEIVED' }],
      ['id vazio', { id: '', event: 'PAYMENT_RECEIVED' }],
      ['sem event', { id: 'evt_1' }],
      ['event não textual', { id: 'evt_1', event: 7 }],
      ['array', [{ id: 'evt_1', event: 'PAYMENT_RECEIVED' }]],
    ])('corpo malformado (%s) → 400', async (_label, body) => {
      expect((await webhook(body).expect(400)).body).toEqual({ code: 'invalid_event' });
    });

    it('corpo acima de 64 KB → 400', async () => {
      const body = { id: 'evt_big', event: 'PAYMENT_RECEIVED', filler: 'x'.repeat(70_000) };
      expect((await webhook(body).expect(400)).body).toEqual({ code: 'invalid_event' });
    });

    it('PAYMENT_RECEIVED agenda; o GET reflete; mesmo id não reprocessa; já paga → already_paid', async () => {
      const order = await createOrder();
      expect((await webhook(paidEvent(order)).expect(200)).body).toEqual({ received: true });
      const got = await request(server()).get(`/sponsorships/${order.id}`).expect(200);
      expect(got.body).toMatchObject({
        status: 'scheduled',
        startsInMinutes: 0,
        payment: {
          gateway: 'asaas',
          method: 'pix',
          refund: null,
          paidAt: clock.now().toISOString(),
        },
      });
      expect(repository.events.get(`evt_${order.id}_PAYMENT_RECEIVED`)?.outcome).toBe('scheduled');

      const startsAt = got.body.startsAt;
      clock.advance(2 * MIN);
      await webhook(paidEvent(order)).expect(200);
      await webhook(paidEvent(order, { event: 'PAYMENT_CONFIRMED' })).expect(200);
      const again = await request(server()).get(`/sponsorships/${order.id}`).expect(200);
      expect(again.body.startsAt).toBe(startsAt);
      expect(
        [...repository.events.values()].filter((e) => e.sponsorshipId === order.id),
      ).toHaveLength(2);
      expect(
        (await request(server()).get(`/sponsorships/${order.id}/payment`).expect(409)).body,
      ).toEqual({ code: 'already_paid' });
    });

    it('evento de outro tipo, cobrança divergente ou pedido desconhecido → 200 sem efeito', async () => {
      const order = await createOrder();
      await webhook(paidEvent(order, { event: 'PAYMENT_CREATED' })).expect(200);
      await webhook({
        ...paidEvent(order, { id: 'evt_div' }),
        payment: { id: 'pay_x', externalReference: order.id, value: 10 },
      }).expect(200);
      await webhook({
        ...paidEvent(order, { id: 'evt_unk' }),
        payment: {
          id: 'pay_u',
          externalReference: '3f0e8a52-6c1e-4f0a-9d3b-2a1b4c5d6e7f',
          value: 10,
        },
      }).expect(200);
      expect(repository.rows.get(order.id)!.status).toBe('pending_payment');
      expect(repository.events.get(`evt_${order.id}_PAYMENT_CREATED`)?.outcome).toBe('ignored');
      expect(repository.events.get('evt_div')?.outcome).toBe('rejected');
      expect(repository.events.get('evt_unk')?.outcome).toBe('rejected');
    });

    it('pagamento de pedido ainda pendente de moderação → expired + estorno (image-moderation AC-13)', async () => {
      repository.autoApprove = false;
      const order = await createOrder();
      repository.autoApprove = true;
      await webhook(paidEvent(order)).expect(200);
      expect(repository.rows.get(order.id)).toMatchObject({
        status: 'expired',
        expiryReason: 'moderation_pending',
        refund: 'requested',
        moderation: 'pending',
      });
      expect(repository.events.get(`evt_${order.id}_PAYMENT_RECEIVED`)).toMatchObject({
        outcome: 'refund_requested',
      });
      const shown = await request(server()).get(`/sponsorships/${order.id}`).expect(200);
      expect(shown.body).toMatchObject({
        status: 'expired',
        payment: { refund: 'requested' },
        moderation: { status: 'pending', categories: [] },
      });
    });

    it('pagamento de pedido vencido → expired com estorno pedido; GET mostra refund (AC-07)', async () => {
      const order = await createOrder();
      clock.advance(31 * MIN);
      await webhook(paidEvent(order)).expect(200);
      const got = await request(server()).get(`/sponsorships/${order.id}`).expect(200);
      expect(got.body).toMatchObject({
        status: 'expired',
        payment: { method: 'pix', refund: 'requested' },
      });
      expect(
        (await request(server()).get(`/sponsorships/${order.id}/payment`).expect(409)).body,
      ).toEqual({ code: 'expired' });
      clock.advance(-31 * MIN);
    });
  });

  it('GET /:id confere o gateway e agenda um pedido já pago (AC-08)', async () => {
    const order = await createOrder();
    gateway.states.set(`pay_${order.id}`, { state: 'paid', method: 'credit_card' });
    const got = await request(server()).get(`/sponsorships/${order.id}`).expect(200);
    expect(got.body).toMatchObject({ status: 'scheduled', payment: { method: 'credit_card' } });
  });

  it('documento OpenAPI traz as rotas e campos novos (AC-11)', () => {
    const doc = createSwaggerDocument(app) as unknown as {
      paths: Record<string, Record<string, { tags?: string[] }>>;
      components: { schemas: Record<string, { properties: Record<string, unknown> }> };
    };
    expect(doc.paths['/webhooks/asaas'].post.tags).toEqual(['payments']);
    expect(JSON.stringify(doc.paths['/webhooks/asaas'].post)).toContain('AsaasWebhookBodyDto');
    expect(doc.components.schemas.AsaasWebhookBodyDto.properties).toHaveProperty('event');
    expect(doc.paths['/sponsorships/{id}/payment'].get.tags).toEqual(['sponsorships']);
    expect(doc.components.schemas.PaymentInfoDto.properties).toHaveProperty('refund');
    expect(doc.components.schemas.SponsorOfferDto.properties).toHaveProperty('payment');
    expect(doc.components.schemas.CreateSponsorshipBodyDto.properties).toHaveProperty('cpfCnpj');
    expect(JSON.stringify(doc)).not.toContain(TOKEN);
  });
});
