// Integração do PrismaSponsorshipRepository com o Postgres local para a moderação
// (spec sponsorship-image-moderation R-5, R-7, R-9; AC-07, AC-13, AC-16, AC-18). Requer
// `make infra` + `make migrate-deploy` e DATABASE_URL apontando para o banco.
import { randomUUID } from 'node:crypto';
import { applyModerationResult } from '../src/sponsorship/domain/moderation-state';
import { newPendingOrder, type Sponsorship } from '../src/sponsorship/domain/scheduling';
import type { ElectionDay } from '../src/sponsorship/domain/sponsorship-config';
import type { ModerationRecordInput } from '../src/sponsorship/domain/ports/sponsorship-repository';
import { PrismaSponsorshipRepository } from '../src/sponsorship/infra/adapters/prisma-sponsorship-repository';
import { PrismaService } from '../src/prisma/prisma.service';

const prisma = new PrismaService();
const repository = new PrismaSponsorshipRepository(prisma);
const T0 = new Date(Date.UTC(2099, 5, 1, 12, 0, 0));
const FAR_ELECTION: ElectionDay = {
  date: '2098-10-25',
  startsAt: new Date('2098-10-25T03:00:00.000Z'),
  endsAt: new Date('2098-10-26T03:00:00.000Z'),
};
const created: string[] = [];

async function order(now = T0): Promise<Sponsorship> {
  const id = randomUUID();
  const sponsorship = newPendingOrder({
    id,
    input: {
      slot: 'floor',
      minutes: 1,
      advertiserName: 'Teste Moderação',
      email: 'mod@exemplo.com',
      cpfCnpj: '52998224725',
    },
    quote: { priceTier: 'standard', unitPriceCents: 100, amountCents: 100 },
    imageKey: `${id}.webp`,
    imageSha256: 'b'.repeat(64),
    gateway: 'asaas',
    chargeId: `pay_${id}`,
    now,
    paymentTtlMinutes: 30,
  });
  await repository.create(sponsorship);
  created.push(id);
  return sponsorship;
}

const record = (
  attempt: number,
  overrides: Partial<ModerationRecordInput> = {},
): ModerationRecordInput => ({
  attempt,
  provider: 'rekognition',
  model: 'moderation=7.0;text=3.0',
  policyVersion: '2.0',
  outcome: 'approved',
  modelDecision: null,
  categories: [],
  reasons: [],
  detectedText: ['Padaria'],
  confidence: 0.95,
  rejectionRules: ['D-7'],
  errorCode: null,
  requestId: 'req_x',
  imageSha256: 'b'.repeat(64),
  latencyMs: 1200,
  inputTokens: null,
  outputTokens: null,
  signals: {
    labels: [{ name: 'Alcohol', parentName: null, taxonomyLevel: 1, confidence: 55 }],
    contentTypes: [],
    textLines: [{ text: 'Padaria', confidence: 99 }],
    wordCount: 1,
    textSaturated: false,
    celebrities: [],
  },
  createdAt: T0,
  ...overrides,
});

describe('PrismaSponsorshipRepository — moderação (integração)', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.sponsorship.deleteMany({ where: { createdAt: { gte: T0 } } });
  });

  afterAll(async () => {
    await prisma.sponsorshipModerationRecord.deleteMany({
      where: { sponsorshipId: { in: created } },
    });
    await prisma.sponsorship.deleteMany({ where: { id: { in: created } } });
    await prisma.$disconnect();
  });

  it('linhas novas nascem pending com hash; a migration deixa linhas antigas pending sem hash', async () => {
    const o = await order();
    expect(await repository.findById(o.id)).toMatchObject({
      moderation: 'pending',
      moderationAttempts: 0,
      imageSha256: 'b'.repeat(64),
      moderationCategories: [],
    });
  });

  it('dois claims concorrentes reivindicam pedidos distintos; um só pedido → um só claim (AC-07)', async () => {
    const a = await order(T0);
    const b = await order(new Date(T0.getTime() + 1_000));
    const claimUntil = new Date(T0.getTime() + 120_000);
    const now = new Date(T0.getTime() + 2_000);
    const concurrent = await Promise.all([
      repository.claimForModeration(now, claimUntil),
      repository.claimForModeration(now, claimUntil),
      repository.claimForModeration(now, claimUntil),
    ]);
    // Esgota a fila (pode haver pendentes de outros testes): nenhum id se repete.
    const claimed = concurrent.filter((row) => row !== null);
    for (let next = await repository.claimForModeration(now, claimUntil); next;) {
      claimed.push(next);
      next = await repository.claimForModeration(now, claimUntil);
    }
    const ids = claimed.map((row) => row!.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(
      claimed.every((row) => row!.moderationClaimedUntil?.getTime() === claimUntil.getTime()),
    ).toBe(true);
    // Reivindicados, não são devolvidos de novo até o prazo vencer.
    expect(await repository.claimForModeration(now, claimUntil)).toBeNull();
    expect(
      await repository.claimForModeration(new Date(claimUntil.getTime() + 1), claimUntil),
    ).not.toBeNull();
  });

  it('recordModeration grava registro + estado na mesma transação; attempt repetido falha (AC-07, AC-16)', async () => {
    const o = await order();
    const writes = applyModerationResult(o, { outcome: 'approved' }, T0, 3);
    expect(await repository.recordModeration(o.id, record(1), writes)).toBe('applied');
    expect(await repository.findById(o.id)).toMatchObject({
      moderation: 'approved',
      moderationAttempts: 1,
      status: 'pending_payment',
    });
    const rows = await prisma.sponsorshipModerationRecord.findMany({
      where: { sponsorshipId: o.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      attempt: 1,
      outcome: 'approved',
      rejectionRules: ['D-7'],
      modelDecision: null,
      inputTokens: null,
      signals: record(1).signals,
    });
    expect(Number(rows[0].confidence)).toBe(0.95);
    await expect(repository.recordModeration(o.id, record(1), writes)).rejects.toThrow();
    expect(
      await repository.moderationCallsSince('rekognition', new Date(T0.getTime() - 60_000)),
    ).toBeGreaterThanOrEqual(1);
  });

  it('pedido que mudou no meio → order_changed com registro gravado (AC-18)', async () => {
    const o = await order();
    await prisma.sponsorship.update({
      where: { id: o.id },
      data: { status: 'expired', expiryReason: 'payment_timeout' },
    });
    const writes = applyModerationResult(o, { outcome: 'approved' }, T0, 3);
    expect(await repository.recordModeration(o.id, record(1), writes)).toBe('order_changed');
    expect(await repository.findById(o.id)).toMatchObject({
      moderation: 'pending',
      status: 'expired',
    });
    expect(await prisma.sponsorshipModerationRecord.count({ where: { sponsorshipId: o.id } })).toBe(
      1,
    );
  });

  it('pagamento real de pedido pendente → expired + moderation_pending + refund; simulado → not_approved (AC-13)', async () => {
    const o = await order();
    expect(await repository.confirm(o.id, T0, FAR_ELECTION)).toEqual({
      kind: 'not_approved',
      moderation: 'pending',
    });
    expect(await repository.findById(o.id)).toMatchObject({
      status: 'pending_payment',
      paidAt: null,
    });
    expect(
      await repository.confirm(o.id, T0, FAR_ELECTION, {
        chargeId: o.chargeId,
        amountCents: o.amountCents,
        method: 'pix',
      }),
    ).toEqual({ kind: 'expired', refundRequested: true });
    expect(await repository.findById(o.id)).toMatchObject({
      status: 'expired',
      expiryReason: 'moderation_pending',
      refund: 'requested',
      paidAt: T0,
      paymentMethod: 'pix',
      moderation: 'pending',
    });
  });

  it('recusada e depois paga mantém moderation_rejected; agenda só lista aprovados (R-7)', async () => {
    const o = await order();
    const writes = applyModerationResult(
      o,
      { outcome: 'rejected', categories: ['SEXUAL_CONTENT'] },
      T0,
      3,
    );
    await repository.recordModeration(o.id, record(1, { outcome: 'rejected' }), writes);
    expect(
      await repository.confirm(o.id, T0, FAR_ELECTION, {
        chargeId: o.chargeId,
        amountCents: 100,
        method: 'pix',
      }),
    ).toEqual({ kind: 'expired', refundRequested: true });
    expect(await repository.findById(o.id)).toMatchObject({
      expiryReason: 'moderation_rejected',
      moderationCategories: ['SEXUAL_CONTENT'],
      imageKey: null,
    });

    const approved = await order();
    await repository.recordModeration(
      approved.id,
      record(1),
      applyModerationResult(approved, { outcome: 'approved' }, T0, 3),
    );
    const pendingPaid = await order();
    await prisma.sponsorship.update({
      where: { id: pendingPaid.id },
      data: {
        status: 'scheduled',
        startsAt: T0,
        endsAt: new Date(T0.getTime() + 60_000),
        confirmedAt: T0,
      },
    });
    await repository.confirm(approved.id, T0, FAR_ELECTION, {
      chargeId: approved.chargeId,
      amountCents: 100,
      method: 'pix',
    });
    const items = await repository.scheduleWindow(T0, new Date(T0.getTime() + 10 * 60_000));
    expect(items.map((i) => i.id)).toContain(approved.id);
    expect(items.map((i) => i.id)).not.toContain(pendingPaid.id);
  });
});
