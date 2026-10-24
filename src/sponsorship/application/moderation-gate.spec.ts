// Gate de moderação no pagamento e na publicação (spec sponsorship-image-moderation R-6, R-7;
// AC-10–AC-14, AC-18). Aqui o repositório NÃO aprova automaticamente.
import { SponsorshipError } from '../domain/errors';
import { sha256Hex } from '../domain/image-rules';
import { ConfirmPayment } from './confirm-payment';
import { CreateSponsorship } from './create-sponsorship';
import { GetPaymentInstructions } from './get-payment-instructions';
import { GetSchedule } from './get-schedule';
import { GetSponsorship } from './get-sponsorship';
import { HandleAsaasWebhook } from './handle-asaas-webhook';
import { ReadSponsorImage } from './read-sponsor-image';
import { ReconcilePendingPayment } from './reconcile-pending-payment';
import { FakeImageProcessor } from './__fakes__/fake-image-processor';
import { FakePaymentGateway } from './__fakes__/fake-payment-gateway';
import { FakeClock, PNG_HEADER, asaasTestConfig, testConfig } from './__fakes__/fixtures';
import { InMemoryImageStorage } from './__fakes__/in-memory-image-storage';
import { InMemorySponsorshipRepository } from './__fakes__/in-memory-sponsorship-repository';
import type { RawOrderInput } from '../domain/validation';

const input: RawOrderInput = {
  slot: 'center',
  minutes: '2',
  advertiserName: 'Padaria Central',
  email: 'contato@padaria.com.br',
  cpfCnpj: '529.982.247-25',
  acceptTerms: 'true',
};

function setup(gatewayName: 'simulated' | 'asaas' = 'simulated') {
  const repository = new InMemorySponsorshipRepository();
  const storage = new InMemoryImageStorage();
  const gateway = new FakePaymentGateway(gatewayName);
  const clock = new FakeClock();
  const config = gatewayName === 'asaas' ? asaasTestConfig() : testConfig();
  const warnings: string[] = [];
  const logger = { warn: (m: string) => warnings.push(m) };
  const confirm = new ConfirmPayment(repository, clock, config);
  const reconcile = new ReconcilePendingPayment(repository, gateway, confirm, clock, logger);
  return {
    repository,
    storage,
    gateway,
    clock,
    config,
    warnings,
    create: new CreateSponsorship(
      repository,
      storage,
      new FakeImageProcessor(),
      gateway,
      clock,
      config,
    ),
    confirm,
    reconcile,
    get: new GetSponsorship(repository, clock, config, reconcile),
    instructions: new GetPaymentInstructions(repository, gateway, clock, config),
    schedule: new GetSchedule(repository, clock, config),
    image: new ReadSponsorImage(repository, storage, logger),
    webhook: new HandleAsaasWebhook(repository, confirm, clock),
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

describe('criação (R-2, R-6)', () => {
  it('nasce pending com hash da imagem gravada e moderation pending na resposta', async () => {
    const s = setup();
    const created = await s.create.execute(input, PNG_HEADER);
    expect(created.moderation).toEqual({ status: 'pending', categories: [] });
    const row = s.repository.rows.get(created.id)!;
    expect(row).toMatchObject({
      moderation: 'pending',
      moderationAttempts: 0,
      moderationNextAttemptAt: row.createdAt,
      moderationClaimedUntil: null,
      moderationCategories: [],
    });
    expect(row.imageSha256).toBe(sha256Hex(s.storage.files.get(`${created.id}.webp`)!));
  });
});

describe('gate de pagamento (R-7; AC-11, AC-13)', () => {
  it('simulado: pendente → moderation_pending sem gravar nada (cenário 22)', async () => {
    const s = setup();
    const created = await s.create.execute(input, PNG_HEADER);
    expect(await codeOf(s.confirm.execute(created.id))).toBe('moderation_pending');
    expect(s.repository.rows.get(created.id)).toMatchObject({
      status: 'pending_payment',
      paidAt: null,
    });
    expect(await codeOf(s.instructions.execute(created.id))).toBe('moderation_pending');
  });

  it('simulado: pendente e vencido → expired e grava expired por prazo (sponsorships R-9 antes de R-7)', async () => {
    const s = setup();
    const created = await s.create.execute(input, PNG_HEADER);
    s.clock.advance(31 * 60_000);
    expect(await codeOf(s.confirm.execute(created.id))).toBe('expired');
    expect(s.repository.rows.get(created.id)).toMatchObject({
      status: 'expired',
      expiryReason: 'payment_timeout',
      moderation: 'pending',
      paidAt: null,
    });
    expect(await codeOf(s.instructions.execute(created.id))).toBe('expired');
  });

  it('simulado: recusada → moderation_rejected; erro → moderation_error (cenário 23)', async () => {
    const s = setup();
    const created = await s.create.execute(input, PNG_HEADER);
    const row = s.repository.rows.get(created.id)!;
    Object.assign(row, {
      moderation: 'rejected',
      status: 'expired',
      expiryReason: 'moderation_rejected',
    });
    expect(await codeOf(s.confirm.execute(created.id))).toBe('moderation_rejected');
    expect(await codeOf(s.instructions.execute(created.id))).toBe('moderation_rejected');
    Object.assign(row, { moderation: 'error', expiryReason: 'moderation_error' });
    expect(await codeOf(s.confirm.execute(created.id))).toBe('moderation_error');
    expect(await codeOf(s.instructions.execute(created.id))).toBe('moderation_error');
  });

  it('aprovada → confirma e agenda normalmente; aprovar não grava paidAt (cenário 27)', async () => {
    const s = setup();
    const created = await s.create.execute(input, PNG_HEADER);
    s.repository.approve(created.id);
    expect(s.repository.rows.get(created.id)).toMatchObject({
      status: 'pending_payment',
      paidAt: null,
    });
    expect(s.gateway.calls.getChargeStatus).toBe(0);
    const confirmed = await s.confirm.execute(created.id);
    expect(confirmed.status).toBe('scheduled');
    expect(confirmed.moderation).toEqual({ status: 'approved', categories: [] });
  });

  it('webhook de pedido pendente → expira com moderation_pending e pede estorno (cenário 26)', async () => {
    const s = setup('asaas');
    const created = await s.create.execute(input, PNG_HEADER);
    const outcome = await s.webhook.execute({
      id: 'evt_1',
      event: 'PAYMENT_RECEIVED',
      payment: {
        id: s.gateway.chargeIdOf(created.id),
        externalReference: created.id,
        value: 6000,
        billingType: 'PIX',
      },
    });
    expect(outcome).toBe('refund_requested');
    expect(s.repository.rows.get(created.id)).toMatchObject({
      status: 'expired',
      expiryReason: 'moderation_pending',
      refund: 'requested',
      paidAt: s.clock.now(),
      paymentMethod: 'pix',
      moderation: 'pending',
    });
  });

  it('webhook de pendente vencido → payment_timeout e estorno, não moderation_pending (asaas-payment R-5)', async () => {
    const s = setup('asaas');
    const created = await s.create.execute(input, PNG_HEADER);
    s.clock.advance(31 * 60_000);
    const outcome = await s.webhook.execute({
      id: 'evt_late',
      event: 'PAYMENT_RECEIVED',
      payment: {
        id: s.gateway.chargeIdOf(created.id),
        externalReference: created.id,
        value: 6000,
        billingType: 'PIX',
      },
    });
    expect(outcome).toBe('refund_requested');
    expect(s.repository.rows.get(created.id)).toMatchObject({
      status: 'expired',
      expiryReason: 'payment_timeout',
      refund: 'requested',
      moderation: 'pending',
    });
  });

  it('webhook de pedido recusado mantém o motivo e pede estorno; evento repetido não duplica (28)', async () => {
    const s = setup('asaas');
    const created = await s.create.execute(input, PNG_HEADER);
    Object.assign(s.repository.rows.get(created.id)!, {
      moderation: 'rejected',
      status: 'expired',
      expiryReason: 'moderation_rejected',
      imageKey: null,
    });
    const event = {
      id: 'evt_2',
      event: 'PAYMENT_RECEIVED',
      payment: {
        id: s.gateway.chargeIdOf(created.id),
        externalReference: created.id,
        value: 6000,
        billingType: 'PIX',
      },
    };
    expect(await s.webhook.execute(event)).toBe('refund_requested');
    expect(await s.webhook.execute(event)).toBe('duplicate');
    expect(s.repository.rows.get(created.id)).toMatchObject({
      expiryReason: 'moderation_rejected',
      refund: 'requested',
      moderation: 'rejected',
    });
    expect(s.repository.events.size).toBe(1);
  });

  it('consulta sob demanda não consulta o gateway de pedido não aprovado', async () => {
    const s = setup('asaas');
    const created = await s.create.execute(input, PNG_HEADER);
    s.gateway.states.set(s.gateway.chargeIdOf(created.id), { state: 'paid', method: 'pix' });
    expect((await s.get.execute(created.id)).status).toBe('pending_payment');
    expect(s.gateway.calls.getChargeStatus).toBe(0);
  });
});

describe('publicação (R-6, R-7; AC-10)', () => {
  async function scheduledOrder(s: ReturnType<typeof setup>) {
    const created = await s.create.execute(input, PNG_HEADER);
    s.repository.approve(created.id);
    await s.confirm.execute(created.id);
    return created.id;
  }

  it('agenda e imagem só para pedido aprovado', async () => {
    const s = setup();
    const id = await scheduledOrder(s);
    expect((await s.schedule.execute()).items.map((i) => i.id)).toEqual([id]);
    expect(await s.image.execute(id)).toBeInstanceOf(Buffer);

    const row = s.repository.rows.get(id)!;
    row.moderation = 'pending';
    expect((await s.schedule.execute()).items).toEqual([]);
    expect(await codeOf(s.image.execute(id))).toBe('not_found');
  });

  it('arquivo diferente do hash analisado → 404 e aviso (cenário 25)', async () => {
    const s = setup();
    const id = await scheduledOrder(s);
    s.storage.files.set(`${id}.webp`, Buffer.from('WEBP:outra-imagem'));
    expect(await codeOf(s.image.execute(id))).toBe('not_found');
    expect(s.warnings.some((w) => w.includes(id))).toBe(true);
  });

  it('pedido público traz as categorias só quando recusado (FR-03)', async () => {
    const s = setup();
    const created = await s.create.execute(input, PNG_HEADER);
    const row = s.repository.rows.get(created.id)!;
    Object.assign(row, {
      moderation: 'rejected',
      moderationCategories: ['ELECTORAL_PROPAGANDA'],
      status: 'expired',
      expiryReason: 'moderation_rejected',
    });
    const shown = await s.get.execute(created.id);
    expect(shown.status).toBe('expired');
    expect(shown.moderation).toEqual({ status: 'rejected', categories: ['ELECTORAL_PROPAGANDA'] });
    expect(JSON.stringify(shown)).not.toMatch(/reasons|detected|prompt|confidence/);
  });
});
