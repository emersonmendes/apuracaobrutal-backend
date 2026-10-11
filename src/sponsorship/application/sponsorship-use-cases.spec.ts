import { SponsorshipError } from '../domain/errors';
import { ConfirmPayment } from './confirm-payment';
import { CreateSponsorship } from './create-sponsorship';
import { ExpirePendingSponsorships } from './expire-pending-sponsorships';
import { GetOffer } from './get-offer';
import { GetSchedule } from './get-schedule';
import { GetSponsorship } from './get-sponsorship';
import { ReadSponsorImage } from './read-sponsor-image';
import { FakeImageProcessor } from './__fakes__/fake-image-processor';
import { FakePaymentGateway } from './__fakes__/fake-payment-gateway';
import { FakeClock, PNG_HEADER, testConfig } from './__fakes__/fixtures';
import { InMemoryImageStorage } from './__fakes__/in-memory-image-storage';
import { InMemorySponsorshipRepository } from './__fakes__/in-memory-sponsorship-repository';
import type { RawOrderInput } from '../domain/validation';

const MIN = 60_000;
const input = (overrides: RawOrderInput = {}): RawOrderInput => ({
  slot: 'center',
  minutes: '2',
  advertiserName: 'Padaria Central',
  email: 'contato@padaria.com.br',
  acceptTerms: 'true',
  ...overrides,
});

function setup(configOverrides = {}) {
  const repository = new InMemorySponsorshipRepository();
  const storage = new InMemoryImageStorage();
  const images = new FakeImageProcessor();
  const gateway = new FakePaymentGateway();
  const clock = new FakeClock();
  const config = testConfig(configOverrides);
  let seq = 0;
  const newId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
  const warnings: string[] = [];
  return {
    repository,
    storage,
    images,
    gateway,
    clock,
    config,
    warnings,
    create: new CreateSponsorship(repository, storage, images, gateway, clock, config, newId),
    confirm: new ConfirmPayment(repository, clock, config),
    get: new GetSponsorship(repository, clock),
    offer: new GetOffer(repository, clock, config),
    schedule: new GetSchedule(repository, clock),
    image: new ReadSponsorImage(repository, storage),
    cleanup: new ExpirePendingSponsorships(repository, storage, clock, {
      warn: (m) => warnings.push(m),
    }),
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
      payment: { gateway: 'simulated' },
    });
    expect(created).not.toHaveProperty('email');
    expect(created).not.toHaveProperty('advertiserName');
    expect(s.gateway.charges).toEqual([{ sponsorshipId: created.id, amountCents: 600_000 }]);
    expect(s.storage.files.get(`${created.id}.webp`)?.subarray(0, 5).toString()).toBe('WEBP:');
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
    [input({ acceptTerms: 'false' }), PNG_HEADER, 'terms_not_accepted'],
    [input(), undefined, 'invalid_image'],
    [input(), Buffer.from('<svg></svg>'), 'invalid_image'],
  ])('erro de validação → %s', async (raw, image, code) => {
    const s = setup();
    expect(await codeOf(s.create.execute(raw, image))).toBe(code);
    expect(s.repository.rows.size).toBe(0);
    expect(s.storage.files.size).toBe(0);
  });

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

    expect(await s.cleanup.execute()).toEqual({ expired: 1, imagesRemoved: 1 });
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
    expect(await s.cleanup.execute()).toEqual({ expired: 2, imagesRemoved: 1 });
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
    expect(s.gateway.charges).toEqual([{ sponsorshipId: created.id, amountCents: 1_000 }]);
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
