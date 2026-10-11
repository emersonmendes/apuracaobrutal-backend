import {
  FakeImageAnalyzer,
  rawCelebrity,
  rawLabel,
  rawSignals,
} from '../../moderation/application/__fakes__/fake-image-analyzer';
import { ModerateImage } from '../../moderation/application/moderate-image';
import { sha256Hex } from '../domain/image-rules';
import { newPendingOrder } from '../domain/scheduling';
import { ModeratePendingSponsorships } from './moderate-pending-sponsorships';
import { FakePaymentGateway } from './__fakes__/fake-payment-gateway';
import { FakeCandidateIdentity, FakeClock, TEST_CPF, testConfig } from './__fakes__/fixtures';
import { InMemoryImageStorage } from './__fakes__/in-memory-image-storage';
import { InMemorySponsorshipRepository } from './__fakes__/in-memory-sponsorship-repository';

const IMAGE = Buffer.from('WEBP:imagem-de-teste');
const TIMEOUT_MS = 1_000;

const ok = (parts: Parameters<typeof rawSignals>[0] = {}) =>
  rawSignals({ lines: ['Padaria Central'], ...parts });
const RUNTIME = { timeoutMs: TIMEOUT_MS, labelMinConfidence: 60, celebrityMinConfidence: 90 };

function setup(options: { gateway?: 'simulated' | 'asaas'; maxPerHour?: number } = {}) {
  const repository = new InMemorySponsorshipRepository();
  const storage = new InMemoryImageStorage();
  const analyzer = new FakeImageAnalyzer();
  const gateway = new FakePaymentGateway(options.gateway ?? 'simulated');
  const clock = new FakeClock();
  const config = testConfig({
    moderation: { maxAttempts: 3, maxPerHour: options.maxPerHour ?? 200 },
  });
  const logs: string[] = [];
  const warnings: string[] = [];
  let seq = 0;
  const addOrder = async (overrides: { image?: Buffer; createdAt?: Date } = {}) => {
    const id = `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
    const image = overrides.image ?? IMAGE;
    const now = overrides.createdAt ?? clock.now();
    const order = newPendingOrder({
      id,
      input: {
        slot: 'center',
        minutes: 2,
        advertiserName: 'Padaria',
        email: 'a@b.c',
        cpfCnpj: TEST_CPF,
      },
      quote: { priceTier: 'election_day', unitPriceCents: 300_000, amountCents: 600_000 },
      imageKey: `${id}.webp`,
      imageSha256: sha256Hex(image),
      gateway: gateway.name,
      chargeId: gateway.chargeIdOf(id),
      now,
      paymentTtlMinutes: 30,
    });
    await repository.create(order);
    await storage.save(order.imageKey!, image);
    return order;
  };
  const useCase = new ModeratePendingSponsorships(
    repository,
    storage,
    new ModerateImage(analyzer, TIMEOUT_MS),
    new FakeCandidateIdentity(),
    gateway,
    clock,
    config,
    RUNTIME,
    { log: (m) => logs.push(m), warn: (m) => warnings.push(m) },
  );
  return { repository, storage, analyzer, gateway, clock, logs, warnings, addOrder, useCase };
}

describe('ModeratePendingSponsorships — spec sponsorship-image-moderation FR-05, Fluxo 3', () => {
  it('sem pedidos pendentes não faz nada', async () => {
    const s = setup();
    expect(await s.useCase.execute()).toEqual({ processed: 0 });
    expect(s.analyzer.calls).toHaveLength(0);
  });

  it('aprova: registro de auditoria completo, status intacto, imagem mantida (AC-14, AC-16)', async () => {
    const s = setup();
    const order = await s.addOrder();
    s.analyzer.respond(ok());
    expect(await s.useCase.execute()).toEqual({ processed: 1, outcome: 'approved' });

    expect(s.analyzer.calls[0]).toEqual({ image: IMAGE, mediaType: 'image/webp' });
    expect(s.repository.rows.get(order.id)).toMatchObject({
      moderation: 'approved',
      moderationAttempts: 1,
      moderationClaimedUntil: null,
      status: 'pending_payment',
      imageKey: `${order.id}.webp`,
      paidAt: null,
    });
    expect(s.repository.moderationRecords).toEqual([
      expect.objectContaining({
        sponsorshipId: order.id,
        attempt: 1,
        provider: 'rekognition',
        model: 'fake-model',
        policyVersion: '2.0',
        outcome: 'approved',
        modelDecision: null,
        categories: [],
        reasons: [],
        detectedText: ['Padaria Central'],
        confidence: null,
        rejectionRules: ['D-7'],
        errorCode: null,
        requestId: 'req_1',
        imageSha256: sha256Hex(IMAGE),
        inputTokens: null,
        outputTokens: null,
        signals: expect.objectContaining({
          textLines: [{ text: 'Padaria Central', confidence: 99 }],
          wordCount: 2,
          labels: [],
          celebrities: [],
        }),
      }),
    ]);
    expect(s.storage.files.has(`${order.id}.webp`)).toBe(true);
    expect(s.logs[0]).toMatch(/approved/);
    expect(s.logs[0]).toMatch(/labels=0 lines=1 faces=0/);
    expect(s.logs[0]).not.toMatch(/Padaria Central/);
  });

  it('recusa: expira, grava categorias, apaga a imagem e cancela a cobrança asaas (AC-14)', async () => {
    const s = setup({ gateway: 'asaas' });
    const order = await s.addOrder();
    s.analyzer.respond(ok({ lines: ['VOTE 13'] }));
    expect(await s.useCase.execute()).toEqual({ processed: 1, outcome: 'rejected' });
    expect(s.repository.rows.get(order.id)).toMatchObject({
      moderation: 'rejected',
      moderationCategories: ['ELECTORAL_PROPAGANDA'],
      status: 'expired',
      expiryReason: 'moderation_rejected',
      imageKey: null,
    });
    expect(s.storage.files.has(`${order.id}.webp`)).toBe(false);
    expect(s.gateway.cancelled).toEqual([order.chargeId]);
    expect(s.repository.moderationRecords[0]).toMatchObject({
      outcome: 'rejected',
      rejectionRules: ['D-5'],
      reasons: ['Texto eleitoral: "VOTE 13" (D-5).'],
    });
    expect(s.logs[0]).not.toMatch(/vote 13|VOTE 13/);
  });

  it('rótulo acima do limiar e rosto de candidato recusam com sinais na auditoria (AC-16)', async () => {
    const s = setup();
    const order = await s.addOrder();
    s.analyzer.respond(
      ok({
        labels: [rawLabel('Explicit', 97.5)],
        celebrities: [rawCelebrity('Luiz Inácio Lula da Silva', 96)],
      }),
    );
    await s.useCase.execute();
    expect(s.repository.rows.get(order.id)).toMatchObject({
      moderation: 'rejected',
      moderationCategories: ['SEXUAL_CONTENT', 'ELECTORAL_PROPAGANDA'],
    });
    expect(s.repository.moderationRecords[0]).toMatchObject({
      outcome: 'rejected',
      modelDecision: null,
      categories: ['SEXUAL_CONTENT', 'ELECTORAL_PROPAGANDA'],
      rejectionRules: ['D-2', 'D-6'],
      confidence: 0.975,
      signals: expect.objectContaining({
        labels: [{ name: 'Explicit', parentName: null, taxonomyLevel: 1, confidence: 97.5 }],
        celebrities: [{ name: 'Luiz Inácio Lula da Silva', id: 'id', matchConfidence: 96 }],
      }),
    });
    expect(s.logs[0]).not.toMatch(/Lula/);
  });

  it('falhas técnicas: backoff, contagem e erro definitivo na 3ª; nunca aprova (AC-06, 30)', async () => {
    const s = setup({ gateway: 'asaas' });
    const order = await s.addOrder();
    const t0 = s.clock.now().getTime();

    s.analyzer.fail('timeout');
    expect(await s.useCase.execute()).toEqual({ processed: 1, outcome: 'retry' });
    expect(s.repository.rows.get(order.id)).toMatchObject({
      moderation: 'pending',
      moderationAttempts: 1,
      moderationNextAttemptAt: new Date(t0 + 10_000),
      moderationClaimedUntil: null,
    });
    expect(s.repository.moderationRecords[0]).toMatchObject({
      outcome: 'error',
      errorCode: 'timeout',
    });

    // Ainda não chegou a hora: nada acontece, nenhuma chamada.
    expect(await s.useCase.execute()).toEqual({ processed: 0 });
    expect(s.analyzer.calls).toHaveLength(1);

    s.clock.advance(10_000);
    s.analyzer.fail('rate_limited');
    await s.useCase.execute();
    expect(s.repository.rows.get(order.id)).toMatchObject({
      moderationAttempts: 2,
      moderationNextAttemptAt: new Date(t0 + 10_000 + 60_000),
    });

    s.clock.advance(60_000);
    s.analyzer.respond('não é objeto');
    expect(await s.useCase.execute()).toEqual({ processed: 1, outcome: 'error' });
    expect(s.repository.rows.get(order.id)).toMatchObject({
      moderation: 'error',
      moderationAttempts: 3,
      status: 'expired',
      expiryReason: 'moderation_error',
      imageKey: null,
    });
    expect(s.repository.moderationRecords.map((r) => r.errorCode)).toEqual([
      'timeout',
      'rate_limited',
      'invalid_response',
    ]);
    expect(s.storage.files.has(`${order.id}.webp`)).toBe(false);
    expect(s.gateway.cancelled).toEqual([order.chargeId]);
    expect(s.analyzer.calls).toHaveLength(3);
    // Esgotadas as tentativas, nada mais é reivindicado.
    expect(await s.useCase.execute()).toEqual({ processed: 0 });
  });

  it('teto por hora: não chama a API e devolve o pedido à fila (AC-08)', async () => {
    const s = setup({ maxPerHour: 1 });
    await s.addOrder();
    await s.addOrder();
    s.analyzer.respond(ok());
    expect(await s.useCase.execute()).toEqual({ processed: 1, outcome: 'approved' });
    expect(await s.useCase.execute()).toEqual({ processed: 0, skipped: 'hourly_cap' });
    expect(s.analyzer.calls).toHaveLength(1);
    expect(s.warnings[0]).toMatch(/teto/);
    const waiting = [...s.repository.rows.values()].find((r) => r.moderation === 'pending')!;
    expect(waiting.moderationClaimedUntil).toBeNull();
    expect(waiting.moderationAttempts).toBe(0);
  });

  it('arquivo ≠ hash → image_mismatch sem chamar a API (AC-10, cenário 25)', async () => {
    const s = setup();
    const order = await s.addOrder();
    await s.storage.save(order.imageKey!, Buffer.from('WEBP:trocada'));
    expect(await s.useCase.execute()).toEqual({ processed: 1, outcome: 'rejected' });
    expect(s.analyzer.calls).toHaveLength(0);
    expect(s.repository.moderationRecords[0]).toMatchObject({
      outcome: 'rejected',
      errorCode: 'image_mismatch',
      imageSha256: sha256Hex(Buffer.from('WEBP:trocada')),
    });
    expect(s.repository.rows.get(order.id)!.moderation).toBe('rejected');
  });

  it('arquivo ausente → image_missing conta como tentativa', async () => {
    const s = setup();
    const order = await s.addOrder();
    s.storage.files.delete(order.imageKey!);
    expect(await s.useCase.execute()).toEqual({ processed: 1, outcome: 'retry' });
    expect(s.repository.moderationRecords[0]).toMatchObject({
      outcome: 'error',
      errorCode: 'image_missing',
    });
  });

  it('pedido expirado durante a análise: registro gravado, pedido intacto (AC-18)', async () => {
    const s = setup();
    const order = await s.addOrder();
    const row = s.repository.rows.get(order.id)!;
    s.analyzer.respond(ok());
    // Simula a expiração por prazo entre a reivindicação e a gravação.
    const original = s.repository.recordModeration.bind(s.repository);
    s.repository.recordModeration = async (id, record, writes) => {
      row.status = 'expired';
      row.expiryReason = 'payment_timeout';
      return original(id, record, writes);
    };
    expect(await s.useCase.execute()).toEqual({ processed: 1, outcome: 'order_changed' });
    expect(row).toMatchObject({
      moderation: 'pending',
      status: 'expired',
      expiryReason: 'payment_timeout',
    });
    expect(s.repository.moderationRecords).toHaveLength(1);
  });

  it('pedidos mais antigos primeiro; pendentes vencidos não são reivindicados', async () => {
    const s = setup();
    const older = await s.addOrder({ createdAt: new Date(s.clock.now().getTime() - 60_000) });
    await s.addOrder();
    const expired = await s.addOrder({
      createdAt: new Date(s.clock.now().getTime() - 60 * 60_000),
    });
    s.analyzer.respond(ok()).respond(ok());
    await s.useCase.execute();
    expect(s.repository.rows.get(older.id)!.moderation).toBe('approved');
    await s.useCase.execute();
    expect(await s.useCase.execute()).toEqual({ processed: 0 });
    expect(s.repository.rows.get(expired.id)!.moderation).toBe('pending');
  });

  it('falha ao apagar a imagem ou cancelar a cobrança não muda a decisão', async () => {
    const s = setup({ gateway: 'asaas' });
    const order = await s.addOrder();
    s.storage.failingKeys.add(order.imageKey!);
    s.gateway.failAlways.add('cancelCharge');
    s.analyzer.respond(ok({ labels: [rawLabel('Explicit', 99)] }));
    expect(await s.useCase.execute()).toEqual({ processed: 1, outcome: 'rejected' });
    expect(s.repository.rows.get(order.id)!.moderation).toBe('rejected');
    expect(s.warnings).toHaveLength(2);
  });
});
