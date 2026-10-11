import { SponsorshipError } from '../domain/errors';
import { ConfirmPayment } from './confirm-payment';
import { CreateSponsorship } from './create-sponsorship';
import { ExpirePendingSponsorships } from './expire-pending-sponsorships';
import { GetOffer } from './get-offer';
import { GetPaymentInstructions } from './get-payment-instructions';
import { GetSchedule } from './get-schedule';
import { GetSponsorship } from './get-sponsorship';
import { HandleAsaasWebhook } from './handle-asaas-webhook';
import { ProcessPaymentRefunds } from './process-payment-refunds';
import { ReadSponsorImage } from './read-sponsor-image';
import { ReconcilePendingPayment } from './reconcile-pending-payment';
import { FakeImageProcessor } from './__fakes__/fake-image-processor';
import { FakePaymentGateway } from './__fakes__/fake-payment-gateway';
import { FakeClock, PNG_HEADER, TEST_CPF, asaasTestConfig, testConfig } from './__fakes__/fixtures';
import { InMemoryImageStorage } from './__fakes__/in-memory-image-storage';
import { InMemorySponsorshipRepository } from './__fakes__/in-memory-sponsorship-repository';
import type { SponsorshipConfig } from '../domain/sponsorship-config';
import type { RawOrderInput } from '../domain/validation';

const MIN = 60_000;
const input = (overrides: RawOrderInput = {}): RawOrderInput => ({
  slot: 'center',
  minutes: '2',
  advertiserName: 'Padaria Central',
  email: 'contato@padaria.com.br',
  cpfCnpj: '529.982.247-25',
  acceptTerms: 'true',
  ...overrides,
});

function setup(
  configOverrides: Partial<SponsorshipConfig> = {},
  gatewayName: 'simulated' | 'asaas' = 'simulated',
) {
  const repository = new InMemorySponsorshipRepository();
  // Fluxos de pagamento/agenda: a moderação já aprovou (o gate em si é testado à parte).
  repository.autoApprove = true;
  const storage = new InMemoryImageStorage();
  const images = new FakeImageProcessor();
  const gateway = new FakePaymentGateway(gatewayName);
  const clock = new FakeClock();
  const config =
    gatewayName === 'asaas' ? asaasTestConfig(configOverrides) : testConfig(configOverrides);
  let seq = 0;
  const newId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
  const warnings: string[] = [];
  const errors: string[] = [];
  const logger = { warn: (m: string) => warnings.push(m), error: (m: string) => errors.push(m) };
  const confirm = new ConfirmPayment(repository, clock, config);
  const reconcile = new ReconcilePendingPayment(repository, gateway, confirm, clock, logger);
  return {
    repository,
    storage,
    images,
    gateway,
    clock,
    config,
    warnings,
    errors,
    create: new CreateSponsorship(repository, storage, images, gateway, clock, config, newId),
    confirm,
    reconcile,
    get: new GetSponsorship(repository, clock, config, reconcile),
    offer: new GetOffer(repository, clock, config),
    schedule: new GetSchedule(repository, clock),
    image: new ReadSponsorImage(repository, storage),
    instructions: new GetPaymentInstructions(repository, gateway, clock, config),
    webhook: new HandleAsaasWebhook(repository, confirm, clock),
    refunds: new ProcessPaymentRefunds(repository, gateway, clock, logger),
    cleanup: new ExpirePendingSponsorships(repository, storage, clock, logger, gateway),
  };
}

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return (error as SponsorshipError).code;
  }
  return 'no-error';
};

describe('CreateSponsorship — spec sponsorships FR-04, Fluxo 2', () => {
  it('cria pending_payment com preço congelado, TTL, cobrança e imagem reprocessada (AC-05)', async () => {
    const s = setup();
    const created = await s.create.execute(input(), PNG_HEADER);
    expect(created).toMatchObject({
      slot: 'center',
      minutes: 2,
      priceTier: 'election_day',
      unitPriceCents: 300_000,
      amountCents: 600_000,
      status: 'pending_payment',
      paymentExpiresAt: new Date('2026-10-25T23:30:00.000Z'),
      payment: { gateway: 'simulated', sandbox: true, method: null, refund: null },
    });
    expect(created).not.toHaveProperty('email');
    expect(created).not.toHaveProperty('advertiserName');
    expect(JSON.stringify(created)).not.toContain(TEST_CPF);
    expect(s.gateway.charges).toMatchObject([{ sponsorshipId: created.id, amountCents: 600_000 }]);
    expect(s.repository.rows.get(created.id)).toMatchObject({ cpfCnpj: TEST_CPF, refund: 'none' });
    expect(s.storage.files.get(`${created.id}.webp`)?.subarray(0, 5).toString()).toBe('WEBP:');
  });

  it('link opcional do anúncio é gravado e exposto; ausente → null (sponsor-link R-1, R-2)', async () => {
    const s = setup();
    const linked = await s.create.execute(
      input({ linkUrl: 'https://padaria.com.br/promo' }),
      PNG_HEADER,
    );
    expect(linked.linkUrl).toBe('https://padaria.com.br/promo');
    expect(s.repository.rows.get(linked.id)?.linkUrl).toBe('https://padaria.com.br/promo');
    const plain = await s.create.execute(input(), PNG_HEADER);
    expect(plain.linkUrl).toBeNull();
    expect(await codeOf(s.create.execute(input({ linkUrl: 'ftp://x' }), PNG_HEADER))).toBe(
      'invalid_link_url',
    );
  });

  it('mudar a config depois não altera o pedido gravado (AC-05)', async () => {
    const s = setup();
    const created = await s.create.execute(input(), PNG_HEADER);
    s.config.pricesCents.center = 999_999;
    expect((await s.get.execute(created.id)).amountCents).toBe(600_000);
  });

  it.each([
    [input({ slot: 'roof' }), PNG_HEADER, 'invalid_slot'],
    [input({ minutes: '61' }), PNG_HEADER, 'invalid_minutes'],
    [input({ email: 'x' }), PNG_HEADER, 'invalid_email'],
    [input({ cpfCnpj: '529.982.247-26' }), PNG_HEADER, 'invalid_cpf_cnpj'],
    [input({ cpfCnpj: undefined }), PNG_HEADER, 'invalid_cpf_cnpj'],
    [input({ acceptTerms: 'false' }), PNG_HEADER, 'terms_not_accepted'],
    [input(), undefined, 'invalid_image'],
    [input(), Buffer.from('<svg></svg>'), 'invalid_image'],
  ])('erro de validação → %s', async (raw, image, code) => {
    const s = setup();
    expect(await codeOf(s.create.execute(raw, image))).toBe(code);
    expect(s.repository.rows.size).toBe(0);
    expect(s.storage.files.size).toBe(0);
  });

  it('campos de preço/horário vindos do cliente são ignorados; preço e duração só do backend (R-3)', async () => {
    const s = setup();
    const forged = {
      ...input(),
      amountCents: 1,
      unitPriceCents: 1,
      startsAt: '2000-01-01T00:00:00Z',
      endsAt: '2000-01-01T00:01:00Z',
      status: 'scheduled',
    } as RawOrderInput;
    const created = await s.create.execute(forged, PNG_HEADER);
    expect(created).toMatchObject({ unitPriceCents: 300_000, amountCents: 600_000 });
    expect(created.status).toBe('pending_payment');
    expect(s.repository.rows.get(created.id)).toMatchObject({ startsAt: null, endsAt: null });
  });

  it.each(['0', '-1', '1.5', '1e1', '61', '2; DROP TABLE', ' ', '', 'NaN'])(
    'minutos %j → invalid_minutes e nada é gravado (R-3)',
    async (minutes) => {
      const s = setup();
      expect(await codeOf(s.create.execute(input({ minutes }), PNG_HEADER))).toBe(
        'invalid_minutes',
      );
      expect(s.repository.rows.size).toBe(0);
    },
  );

  it('imagem que não decodifica ou fora das dimensões → invalid_image', async () => {
    const s = setup();
    s.images.size = null;
    expect(await codeOf(s.create.execute(input(), PNG_HEADER))).toBe('invalid_image');
    s.images.size = { width: 32, height: 32 };
    expect(await codeOf(s.create.execute(input(), PNG_HEADER))).toBe('invalid_image');
  });

  it('acima do limite de bytes → image_too_large', async () => {
    const s = setup({ imageMaxBytes: 4 });
    expect(await codeOf(s.create.execute(input(), PNG_HEADER))).toBe('image_too_large');
  });

  it('indisponível em produção com gateway simulado (R-9)', async () => {
    const s = setup({ production: true });
    expect(await codeOf(s.create.execute(input(), PNG_HEADER))).toBe('unavailable');
  });

  it('falha ao gravar remove a imagem guardada', async () => {
    const s = setup();
    s.repository.failOnCreate = true;
    await expect(s.create.execute(input(), PNG_HEADER)).rejects.toThrow('falha ao gravar');
    expect(s.storage.files.size).toBe(0);
  });
});

describe('ConfirmPayment — spec sponsorships R-5, R-6, R-9 (AC-06, AC-08)', () => {
  it('local livre: entra no ar no instante do pagamento e dura N minutos', async () => {
    const s = setup();
    const { id } = await s.create.execute(input(), PNG_HEADER);
    s.clock.advance(5 * MIN);
    const confirmed = await s.confirm.execute(id);
    expect(confirmed).toMatchObject({
      status: 'scheduled',
      confirmedAt: new Date('2026-10-25T23:05:00.000Z'),
      startsAt: new Date('2026-10-25T23:05:00.000Z'),
      endsAt: new Date('2026-10-25T23:07:00.000Z'),
      startsInMinutes: 0,
    });
  });

  it('fila por ordem de pagamento, não de criação', async () => {
    const s = setup();
    const first = await s.create.execute(input({ minutes: '3' }), PNG_HEADER);
    const second = await s.create.execute(input({ minutes: '2' }), PNG_HEADER);
    const a = await s.confirm.execute(second.id);
    const b = await s.confirm.execute(first.id);
    expect(b.startsAt).toEqual(a.endsAt);
    expect(b.startsInMinutes).toBe(2);
  });

  it('locais diferentes não interferem', async () => {
    const s = setup();
    const center = await s.create.execute(input(), PNG_HEADER);
    const floor = await s.create.execute(input({ slot: 'floor' }), PNG_HEADER);
    await s.confirm.execute(center.id);
    expect((await s.confirm.execute(floor.id)).startsInMinutes).toBe(0);
  });

  it('é idempotente', async () => {
    const s = setup();
    const { id } = await s.create.execute(input(), PNG_HEADER);
    const first = await s.confirm.execute(id);
    s.clock.advance(2 * MIN);
    expect(await s.confirm.execute(id)).toEqual(first);
  });

  it('vencido → expired e o pedido fica expired', async () => {
    const s = setup();
    const { id } = await s.create.execute(input(), PNG_HEADER);
    s.clock.advance(30 * MIN);
    expect(await codeOf(s.confirm.execute(id))).toBe('expired');
    expect(s.repository.rows.get(id)?.status).toBe('expired');
  });

  it('inexistente → not_found; indisponível → unavailable', async () => {
    expect(await codeOf(setup().confirm.execute('nope'))).toBe('not_found');
    expect(await codeOf(setup({ production: true }).confirm.execute('x'))).toBe('unavailable');
  });
});

describe('GetSponsorship / GetOffer / GetSchedule / ReadSponsorImage', () => {
  it('pendente vencido é devolvido como expired', async () => {
    const s = setup();
    const { id } = await s.create.execute(input(), PNG_HEADER);
    s.clock.advance(31 * MIN);
    expect((await s.get.execute(id)).status).toBe('expired');
  });

  it('oferta traz os seis locais com preço e fila (R-6, R-9)', async () => {
    const s = setup();
    const { id } = await s.create.execute(input({ minutes: '4' }), PNG_HEADER);
    await s.confirm.execute(id);
    const offer = await s.offer.execute();
    expect(offer.available).toBe(true);
    expect(offer.maxMinutes).toBe(60);
    expect(offer.slots.map((slot) => slot.slot)).toEqual([
      'side_left',
      'side_right',
      'center',
      'floor',
      'glove_red',
      'glove_blue',
    ]);
    expect(offer.slots.find((x) => x.slot === 'center')).toEqual({
      slot: 'center',
      unitPriceCents: 300_000,
      electionDayUnitPriceCents: 300_000,
      priceTier: 'election_day',
      queueEndsAt: new Date('2026-10-25T23:04:00.000Z'),
    });
    expect(offer.slots.find((x) => x.slot === 'glove_red')?.unitPriceCents).toBe(
      offer.slots.find((x) => x.slot === 'glove_blue')?.unitPriceCents,
    );
    s.clock.advance(10 * MIN);
    expect(
      (await s.offer.execute()).slots.find((x) => x.slot === 'center')?.queueEndsAt,
    ).toBeNull();
    expect((await setup({ production: true }).offer.execute()).available).toBe(false);
  });

  it('agenda só traz scheduled na janela de 10 min, ordenados (AC-10)', async () => {
    const s = setup();
    const ids: string[] = [];
    for (const minutes of ['5', '5', '5']) {
      const { id } = await s.create.execute(input({ minutes }), PNG_HEADER);
      await s.confirm.execute(id);
      ids.push(id);
    }
    await s.create.execute(input(), PNG_HEADER); // pendente: nunca aparece
    const { serverTime, items } = await s.schedule.execute();
    expect(serverTime).toEqual(s.clock.now());
    // janelas 23:00–23:05, 23:05–23:10, 23:10–23:15 → a terceira começa no fim da janela (23:10)
    expect(items.map((item) => item.id)).toEqual(ids.slice(0, 2));
    s.clock.advance(7 * MIN);
    expect((await s.schedule.execute()).items.map((item) => item.id)).toEqual(ids.slice(1));
  });

  it('imagem só para scheduled com arquivo', async () => {
    const s = setup();
    const { id } = await s.create.execute(input(), PNG_HEADER);
    expect(await codeOf(s.image.execute(id))).toBe('not_found');
    await s.confirm.execute(id);
    expect((await s.image.execute(id)).subarray(0, 5).toString()).toBe('WEBP:');
    s.storage.files.clear();
    expect(await codeOf(s.image.execute(id))).toBe('not_found');
  });
});

describe('ExpirePendingSponsorships — spec sponsorships FR-05 (AC-11)', () => {
  it('expira pendentes vencidos, apaga imagens antigas e preserva o resto', async () => {
    const s = setup();
    const pending = await s.create.execute(input(), PNG_HEADER);
    const aired = await s.create.execute(input({ minutes: '1' }), PNG_HEADER);
    await s.confirm.execute(aired.id);
    s.clock.advance(31 * MIN);
    const fresh = await s.create.execute(input(), PNG_HEADER);

    expect(await s.cleanup.execute()).toEqual({
      expired: 1,
      imagesRemoved: 1,
      chargesCancelled: 0,
    });
    expect(s.repository.rows.get(pending.id)).toMatchObject({ status: 'expired', imageKey: null });
    expect(s.storage.files.has(`${aired.id}.webp`)).toBe(true);
    expect(s.storage.files.has(`${fresh.id}.webp`)).toBe(true);

    s.clock.advance(24 * 60 * MIN);
    await s.cleanup.execute();
    expect(s.repository.rows.get(aired.id)).toMatchObject({ status: 'scheduled', imageKey: null });
    expect(s.storage.files.has(`${aired.id}.webp`)).toBe(false);
  });

  it('falha ao remover um arquivo não impede os demais', async () => {
    const s = setup();
    const a = await s.create.execute(input(), PNG_HEADER);
    const b = await s.create.execute(input(), PNG_HEADER);
    s.storage.failingKeys.add(`${a.id}.webp`);
    s.clock.advance(31 * MIN);
    expect(await s.cleanup.execute()).toEqual({
      expired: 2,
      imagesRemoved: 1,
      chargesCancelled: 0,
    });
    expect(s.storage.files.has(`${b.id}.webp`)).toBe(false);
    expect(s.warnings).toHaveLength(1);
  });
});

describe('preço por período — spec sponsorship-election-pricing R-3–R-5', () => {
  // Fixtures: dia da eleição = [2026-10-25T03:00Z, 2026-10-26T03:00Z).
  const BEFORE = new Date('2026-10-24T15:00:00.000Z');
  const EVE = new Date('2026-10-25T02:50:00.000Z'); // 23:50 da véspera em São Paulo
  const AFTER = new Date('2026-10-27T15:00:00.000Z');

  it('oferta antes do dia: tabela reduzida, com o preço do dia da eleição ao lado (AC-07)', async () => {
    const s = setup();
    s.clock.current = BEFORE;
    const offer = await s.offer.execute();
    expect(offer.electionDay).toEqual(s.config.electionDay);
    expect(
      offer.slots.map(({ slot, unitPriceCents, electionDayUnitPriceCents, priceTier }) => [
        slot,
        unitPriceCents,
        electionDayUnitPriceCents,
        priceTier,
      ]),
    ).toEqual([
      ['side_left', 500, 100_000, 'standard'],
      ['side_right', 500, 100_000, 'standard'],
      ['center', 1_500, 300_000, 'standard'],
      ['floor', 2_500, 500_000, 'standard'],
      ['glove_red', 1_000, 200_000, 'standard'],
      ['glove_blue', 1_000, 200_000, 'standard'],
    ]);
  });

  it('oferta: fila que alcança o dia mostra o preço cheio daquele local', async () => {
    const s = setup();
    s.clock.current = EVE;
    const { id } = await s.create.execute(input({ minutes: '15' }), PNG_HEADER);
    await s.confirm.execute(id);
    const offer = await s.offer.execute();
    expect(offer.slots.find((x) => x.slot === 'center')).toMatchObject({
      priceTier: 'election_day',
      unitPriceCents: 300_000,
    });
    expect(offer.slots.find((x) => x.slot === 'floor')?.priceTier).toBe('standard');
  });

  it('criação com local livre antes do dia → standard (AC-04)', async () => {
    const s = setup();
    s.clock.current = BEFORE;
    const created = await s.create.execute(input({ slot: 'side_left', minutes: '2' }), PNG_HEADER);
    expect(created).toMatchObject({
      priceTier: 'standard',
      unitPriceCents: 500,
      amountCents: 1_000,
    });
    expect(s.gateway.charges).toMatchObject([{ sponsorshipId: created.id, amountCents: 1_000 }]);
  });

  it('criação depois do dia volta à tabela reduzida', async () => {
    const s = setup();
    s.clock.current = AFTER;
    expect((await s.create.execute(input(), PNG_HEADER)).priceTier).toBe('standard');
  });

  it('janela prevista que cruza a 00:00 → pedido inteiro no preço cheio (AC-04)', async () => {
    const s = setup();
    s.clock.current = EVE;
    const created = await s.create.execute(input({ minutes: '15' }), PNG_HEADER);
    expect(created).toMatchObject({
      priceTier: 'election_day',
      unitPriceCents: 300_000,
      amountCents: 15 * 300_000,
    });
  });

  it('fila empurra a janela prevista para dentro do dia → election_day (AC-04)', async () => {
    const s = setup();
    s.clock.current = EVE;
    const first = await s.create.execute(input({ minutes: '9' }), PNG_HEADER);
    expect(first.priceTier).toBe('standard'); // 23:50–23:59
    await s.confirm.execute(first.id);
    const second = await s.create.execute(input({ minutes: '2' }), PNG_HEADER);
    expect(second).toMatchObject({ priceTier: 'election_day', amountCents: 600_000 }); // 23:59–00:01
  });

  it('confirmação: standard cuja janela real passa a cruzar → price_changed, expira; reconfirmar → expired (AC-06)', async () => {
    const s = setup();
    s.clock.current = EVE;
    const cheap = await s.create.execute(input({ minutes: '5' }), PNG_HEADER);
    expect(cheap.priceTier).toBe('standard'); // 23:50–23:55
    s.clock.advance(8 * MIN); // paga 23:58 → 23:58–00:03
    expect(await codeOf(s.confirm.execute(cheap.id))).toBe('price_changed');
    expect(s.repository.rows.get(cheap.id)).toMatchObject({ status: 'expired', startsAt: null });
    expect(await codeOf(s.confirm.execute(cheap.id))).toBe('expired');
  });

  it('confirmação: election_day cuja janela real sai do dia → price_changed (AC-06)', async () => {
    const s = setup();
    s.clock.current = new Date('2026-10-26T02:50:00.000Z'); // 23:50 do dia da eleição
    const full = await s.create.execute(input({ minutes: '5' }), PNG_HEADER);
    expect(full.priceTier).toBe('election_day');
    s.clock.advance(11 * MIN); // paga 00:01 do dia seguinte
    expect(await codeOf(s.confirm.execute(full.id))).toBe('price_changed');
  });

  it('confirmação com a mesma faixa agenda normalmente', async () => {
    const s = setup();
    s.clock.current = BEFORE;
    const order = await s.create.execute(input(), PNG_HEADER);
    s.clock.advance(5 * MIN);
    expect((await s.confirm.execute(order.id)).status).toBe('scheduled');
  });
});

describe('pagamento real via Asaas — spec asaas-payment', () => {
  const BEFORE = new Date('2026-10-24T15:00:00.000Z');
  const EVE = new Date('2026-10-25T02:50:00.000Z'); // 23:50 da véspera em São Paulo
  const EVENT_ID = 'evt_05b708f961d739ea7eba7e4db318f621&368604920';

  /** Evento de cobrança do Asaas para um pedido criado pelo gateway falso. */
  const paidEvent = (
    created: { id: string; amountCents: number },
    overrides: Record<string, unknown> = {},
    payment: Record<string, unknown> = {},
  ) => ({
    id: EVENT_ID,
    event: 'PAYMENT_RECEIVED',
    dateCreated: '2026-10-25 20:05:00',
    payment: {
      object: 'payment',
      id: `pay_${created.id}`,
      externalReference: created.id,
      value: created.amountCents / 100,
      billingType: 'PIX',
      status: 'RECEIVED',
      novoCampoDesconhecido: { x: 1 },
      ...payment,
    },
    ...overrides,
  });

  describe('criação (R-2, R-3; AC-03)', () => {
    it('cria cliente e cobrança com o pagador, dueDate em São Paulo e grava ids e fatura', async () => {
      const s = setup({}, 'asaas');
      s.clock.current = new Date('2026-10-26T02:40:00.000Z'); // 23:40 em São Paulo; prazo 00:10
      const created = await s.create.execute(input(), PNG_HEADER);
      expect(created.payment).toEqual({
        gateway: 'asaas',
        sandbox: true,
        method: null,
        refund: null,
      });
      expect(s.gateway.charges).toEqual([
        {
          sponsorshipId: created.id,
          amountCents: created.amountCents,
          description: 'Patrocínio center — 2 min',
          dueDate: '2026-10-26',
          payer: { name: 'Padaria Central', email: 'contato@padaria.com.br', cpfCnpj: TEST_CPF },
        },
      ]);
      expect(s.repository.rows.get(created.id)).toMatchObject({
        paymentGateway: 'asaas',
        chargeId: `pay_${created.id}`,
        gatewayCustomerId: `cus_${TEST_CPF}`,
        invoiceUrl: `https://sandbox.asaas.com/i/${created.id}`,
        cpfCnpj: TEST_CPF,
      });
    });

    it('falha do gateway → gateway_error, nada gravado, imagem removida', async () => {
      const s = setup({}, 'asaas');
      s.gateway.failNext.add('createCharge');
      await expect(s.create.execute(input(), PNG_HEADER)).rejects.toThrow('createCharge falhou');
      expect(s.repository.rows.size).toBe(0);
      expect(s.storage.files.size).toBe(0);
    });

    it('oferta informa o gateway, o sandbox e as formas de pagamento (R-1, R-9)', async () => {
      expect((await setup({}, 'asaas').offer.execute()).payment).toEqual({
        gateway: 'asaas',
        sandbox: true,
        methods: ['pix', 'credit_card'],
      });
      expect((await setup().offer.execute()).payment).toEqual({
        gateway: 'simulated',
        sandbox: true,
        methods: ['simulated'],
      });
      // Com Asaas a compra fica disponível mesmo em produção (R-1).
      expect((await setup({ production: true }, 'asaas').offer.execute()).available).toBe(true);
    });

    it('a ação simulada não existe com gateway Asaas (FR-03)', async () => {
      const s = setup({}, 'asaas');
      const { id } = await s.create.execute(input(), PNG_HEADER);
      expect(await codeOf(s.confirm.execute(id))).toBe('not_found');
    });
  });

  describe('instruções de pagamento (R-4; AC-04)', () => {
    it('pendente → QR, copia-e-cola, fatura e o prazo do pedido', async () => {
      const s = setup({}, 'asaas');
      const created = await s.create.execute(input(), PNG_HEADER);
      expect(await s.instructions.execute(created.id)).toEqual({
        gateway: 'asaas',
        sandbox: true,
        expiresAt: created.paymentExpiresAt,
        pix: { qrCodeImage: 'iVBORw0KGgoFAKE=', payload: `00020126FAKEpay_${created.id}6304ABCD` },
        card: { invoiceUrl: `https://sandbox.asaas.com/i/${created.id}` },
      });
    });

    it('o QR fica em cache até o prazo do pedido: repetir não consulta o gateway (A-3)', async () => {
      const s = setup({}, 'asaas');
      const created = await s.create.execute(input(), PNG_HEADER);
      await s.instructions.execute(created.id);
      await s.instructions.execute(created.id);
      expect(s.gateway.calls.getPixQrCode).toBe(1);
      s.clock.advance(29 * MIN);
      await s.instructions.execute(created.id);
      expect(s.gateway.calls.getPixQrCode).toBe(1);
    });

    it('vencido → expired; agendado → already_paid; inexistente → not_found; simulado só informa', async () => {
      const s = setup({}, 'asaas');
      const { id } = await s.create.execute(input(), PNG_HEADER);
      s.clock.advance(31 * MIN);
      expect(await codeOf(s.instructions.execute(id))).toBe('expired');
      s.clock.advance(-31 * MIN);
      await s.webhook.execute(paidEvent({ id, amountCents: 600_000 }));
      expect(await codeOf(s.instructions.execute(id))).toBe('already_paid');
      expect(await codeOf(s.instructions.execute('nope'))).toBe('not_found');

      const sim = setup();
      const order = await sim.create.execute(input(), PNG_HEADER);
      expect(await sim.instructions.execute(order.id)).toEqual({
        gateway: 'simulated',
        sandbox: true,
      });
    });
  });

  describe('webhook (R-5, R-6; AC-05, AC-06, AC-07)', () => {
    it('PAYMENT_RECEIVED agenda, registra o pagamento e grava o evento', async () => {
      const s = setup({}, 'asaas');
      s.clock.current = BEFORE;
      const created = await s.create.execute(input(), PNG_HEADER);
      s.clock.advance(5 * MIN);
      expect(await s.webhook.execute(paidEvent(created))).toBe('scheduled');
      const row = s.repository.rows.get(created.id)!;
      expect(row).toMatchObject({
        status: 'scheduled',
        paidAt: s.clock.now(),
        paymentMethod: 'pix',
        refund: 'none',
        startsAt: s.clock.now(),
      });
      expect(s.repository.events.get(EVENT_ID)).toMatchObject({
        gateway: 'asaas',
        event: 'PAYMENT_RECEIVED',
        chargeId: `pay_${created.id}`,
        sponsorshipId: created.id,
        outcome: 'scheduled',
      });
      expect((await s.get.execute(created.id)).payment).toEqual({
        gateway: 'asaas',
        sandbox: true,
        method: 'pix',
        paidAt: s.clock.now(),
        refund: null,
      });
    });

    it('o mesmo id de evento não reprocessa; CONFIRMED e depois RECEIVED agendam uma vez só', async () => {
      const s = setup({}, 'asaas');
      s.clock.current = BEFORE;
      const created = await s.create.execute(input(), PNG_HEADER);
      expect(await s.webhook.execute(paidEvent(created, { event: 'PAYMENT_CONFIRMED' }))).toBe(
        'scheduled',
      );
      const first = s.repository.rows.get(created.id)!.startsAt;
      s.clock.advance(2 * MIN);
      expect(await s.webhook.execute(paidEvent(created, { event: 'PAYMENT_CONFIRMED' }))).toBe(
        'duplicate',
      );
      expect(await s.webhook.execute(paidEvent(created, { id: 'evt_2' }))).toBe('scheduled');
      expect(s.repository.rows.get(created.id)!.startsAt).toEqual(first);
      expect(s.repository.events.size).toBe(2);
    });

    it.each([
      ['cobrança diferente', { id: 'pay_outro' }],
      ['valor diferente', { value: 1 }],
      ['valor não numérico', { value: '6000' }],
      ['pedido desconhecido', { externalReference: '3f0e8a52-6c1e-4f0a-9d3b-2a1b4c5d6e7f' }],
      ['referência malformada', { externalReference: '../etc' }],
    ])('%s → rejected e o pedido não muda', async (_label, payment) => {
      const s = setup({}, 'asaas');
      s.clock.current = BEFORE;
      const created = await s.create.execute(input(), PNG_HEADER);
      expect(await s.webhook.execute(paidEvent(created, {}, payment))).toBe('rejected');
      expect(s.repository.rows.get(created.id)!.status).toBe('pending_payment');
      expect(s.repository.events.get(EVENT_ID)?.outcome).toBe('rejected');
    });

    it('o payload gravado não leva o creditCard (token do cartão) (A-2, FR-02)', async () => {
      const s = setup({}, 'asaas');
      s.clock.current = BEFORE;
      const created = await s.create.execute(input(), PNG_HEADER);
      const event = paidEvent(
        created,
        {},
        {
          billingType: 'CREDIT_CARD',
          creditCard: { creditCardNumber: '8829', creditCardBrand: 'VISA', creditCardToken: 'tok' },
        },
      );
      expect(await s.webhook.execute(event)).toBe('scheduled');
      const stored = s.repository.events.get(EVENT_ID)!.payload as {
        payment: Record<string, unknown>;
      };
      expect(stored.payment).not.toHaveProperty('creditCard');
      expect(stored.payment).toMatchObject({ id: `pay_${created.id}`, billingType: 'CREDIT_CARD' });
      expect(JSON.stringify(stored)).not.toContain('tok');
    });

    it('evento de outro tipo é só registrado', async () => {
      const s = setup({}, 'asaas');
      const created = await s.create.execute(input(), PNG_HEADER);
      expect(await s.webhook.execute(paidEvent(created, { event: 'PAYMENT_CREATED' }))).toBe(
        'ignored',
      );
      expect(s.repository.rows.get(created.id)!.status).toBe('pending_payment');
    });

    it('pagamento de pedido vencido: expira, registra o pagamento e pede estorno', async () => {
      const s = setup({}, 'asaas');
      s.clock.current = BEFORE;
      const created = await s.create.execute(input(), PNG_HEADER);
      s.clock.advance(31 * MIN);
      expect(await s.webhook.execute(paidEvent(created))).toBe('refund_requested');
      expect(s.repository.rows.get(created.id)).toMatchObject({
        status: 'expired',
        expiryReason: 'payment_timeout',
        refund: 'requested',
        paidAt: s.clock.now(),
        paymentMethod: 'pix',
        startsAt: null,
      });
      expect((await s.get.execute(created.id)).payment.refund).toBe('requested');
    });

    it('pagamento com faixa de preço mudada: expira por price_changed e pede estorno', async () => {
      const s = setup({}, 'asaas');
      s.clock.current = EVE;
      const cheap = await s.create.execute(input({ minutes: '5' }), PNG_HEADER);
      expect(cheap.priceTier).toBe('standard');
      s.clock.advance(8 * MIN); // 23:58 → janela cruza a 00:00
      expect(await s.webhook.execute(paidEvent(cheap, { payment: undefined }, {}))).toBe(
        'rejected',
      );
      expect(await s.webhook.execute(paidEvent(cheap, { id: 'evt_x' }))).toBe('refund_requested');
      expect(s.repository.rows.get(cheap.id)).toMatchObject({
        status: 'expired',
        expiryReason: 'price_changed',
        refund: 'requested',
      });
    });

    it('PAYMENT_REFUNDED conclui o estorno, mesmo que tenha sido manual', async () => {
      const s = setup({}, 'asaas');
      const created = await s.create.execute(input(), PNG_HEADER);
      expect(
        await s.webhook.execute(paidEvent(created, { event: 'PAYMENT_REFUNDED', id: 'evt_r' })),
      ).toBe('refund_done');
      expect(s.repository.rows.get(created.id)).toMatchObject({
        refund: 'done',
        refundedAt: s.clock.now(),
      });
      expect(
        await s.webhook.execute(
          paidEvent(created, { event: 'PAYMENT_REFUNDED', id: 'evt_r2' }, { id: 'pay_x' }),
        ),
      ).toBe('rejected');
    });
  });

  describe('consulta sob demanda (R-5 b; AC-08)', () => {
    it('cobrança paga no gateway → o GET já devolve scheduled', async () => {
      const s = setup({}, 'asaas');
      s.clock.current = BEFORE;
      const created = await s.create.execute(input(), PNG_HEADER);
      expect((await s.get.execute(created.id)).status).toBe('pending_payment');
      s.gateway.states.set(`pay_${created.id}`, { state: 'paid', method: 'credit_card' });
      s.clock.advance(6_000);
      const got = await s.get.execute(created.id);
      expect(got.status).toBe('scheduled');
      expect(got.payment).toMatchObject({ method: 'credit_card', paidAt: s.clock.now() });
    });

    it('no máximo uma consulta ao gateway a cada 5 s por pedido; falha é silenciosa', async () => {
      const s = setup({}, 'asaas');
      s.clock.current = BEFORE;
      const created = await s.create.execute(input(), PNG_HEADER);
      await s.get.execute(created.id);
      s.clock.advance(4_000);
      await s.get.execute(created.id);
      expect(s.gateway.calls.getChargeStatus).toBe(1);
      s.clock.advance(1_000);
      s.gateway.failNext.add('getChargeStatus');
      expect((await s.get.execute(created.id)).status).toBe('pending_payment');
      expect(s.gateway.calls.getChargeStatus).toBe(2);
      expect(s.warnings).toHaveLength(1);
    });

    it('não consulta pedidos vencidos, agendados ou do gateway simulado', async () => {
      const s = setup({}, 'asaas');
      const created = await s.create.execute(input(), PNG_HEADER);
      s.clock.advance(31 * MIN);
      expect((await s.get.execute(created.id)).status).toBe('expired');
      expect(s.gateway.calls.getChargeStatus).toBe(0);

      const sim = setup();
      const order = await sim.create.execute(input(), PNG_HEADER);
      await sim.get.execute(order.id);
      expect(sim.gateway.calls.getChargeStatus).toBe(0);
    });
  });

  describe('estornos (R-7; AC-09)', () => {
    async function paidLate(s: ReturnType<typeof setup>) {
      s.clock.current = BEFORE;
      const created = await s.create.execute(input(), PNG_HEADER);
      s.clock.advance(31 * MIN);
      await s.webhook.execute(paidEvent(created, { id: `evt_${created.id}` }));
      return created;
    }

    it('estorna os pedidos requested e marca done', async () => {
      const s = setup({}, 'asaas');
      const created = await paidLate(s);
      expect(await s.refunds.execute()).toEqual({ done: 1, retried: 0, failed: 0 });
      expect(s.gateway.refunds).toEqual([
        {
          chargeId: `pay_${created.id}`,
          amountCents: created.amountCents,
          reason: 'Patrocínio não agendado',
        },
      ]);
      expect(s.repository.rows.get(created.id)).toMatchObject({
        refund: 'done',
        refundAttempts: 1,
        refundedAt: s.clock.now(),
      });
      expect(await s.refunds.execute()).toEqual({ done: 0, retried: 0, failed: 0 });
    });

    it('falha conta uma tentativa e fica para depois; na 20ª vira failed', async () => {
      const s = setup({}, 'asaas');
      const created = await paidLate(s);
      s.gateway.failAlways.add('refund');
      for (let attempt = 1; attempt < 20; attempt++) {
        expect(await s.refunds.execute()).toEqual({ done: 0, retried: 1, failed: 0 });
      }
      expect(s.repository.rows.get(created.id)).toMatchObject({
        refund: 'requested',
        refundAttempts: 19,
      });
      expect(await s.refunds.execute()).toEqual({ done: 0, retried: 0, failed: 1 });
      expect(s.repository.rows.get(created.id)).toMatchObject({
        refund: 'failed',
        refundAttempts: 20,
      });
      expect(s.errors).toHaveLength(1);
      expect(s.errors[0]).not.toContain('Padaria');
    });

    it('gateway simulado nunca estorna', async () => {
      expect(await setup().refunds.execute()).toEqual({ done: 0, retried: 0, failed: 0 });
    });
  });

  describe('expiração cancela a cobrança (R-8; AC-10)', () => {
    it('cancela uma vez por pedido expirado; falha não impede a expiração', async () => {
      const s = setup({}, 'asaas');
      const a = await s.create.execute(input(), PNG_HEADER);
      const b = await s.create.execute(input(), PNG_HEADER);
      s.clock.advance(31 * MIN);
      s.gateway.failNext.add('cancelCharge');
      expect(await s.cleanup.execute()).toEqual({
        expired: 2,
        imagesRemoved: 2,
        chargesCancelled: 1,
      });
      expect(s.gateway.calls.cancelCharge).toBe(2);
      expect(s.gateway.cancelled).toEqual([`pay_${b.id}`]);
      expect(s.repository.rows.get(a.id)).toMatchObject({
        status: 'expired',
        expiryReason: 'payment_timeout',
      });
      expect(s.warnings).toHaveLength(1);
      expect(await s.cleanup.execute()).toEqual({
        expired: 0,
        imagesRemoved: 0,
        chargesCancelled: 0,
      });
    });

    it('gateway simulado não cancela nada', async () => {
      const s = setup();
      await s.create.execute(input(), PNG_HEADER);
      s.clock.advance(31 * MIN);
      expect((await s.cleanup.execute()).chargesCancelled).toBe(0);
      expect(s.gateway.calls.cancelCharge).toBe(0);
    });
  });
});
