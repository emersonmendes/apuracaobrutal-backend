// Integração do PrismaSponsorshipRepository com o Postgres local (spec sponsorships R-5, R-9,
// AC-07; sponsorship-election-pricing R-5, AC-06, AC-08). Requer `make infra` + `make migrate-deploy` e DATABASE_URL apontando para o banco.
import { randomUUID } from 'node:crypto';
import { newPendingOrder, type Sponsorship } from '../src/sponsorship/domain/scheduling';
import type { PriceTier } from '../src/sponsorship/domain/pricing';
import type { SponsorshipSlot } from '../src/sponsorship/domain/slots';
import type { ElectionDay } from '../src/sponsorship/domain/sponsorship-config';
import { PrismaSponsorshipRepository } from '../src/sponsorship/infra/adapters/prisma-sponsorship-repository';
import { PrismaService } from '../src/prisma/prisma.service';

const prisma = new PrismaService();
const repository = new PrismaSponsorshipRepository(prisma);
// Data distante e exclusiva do teste: dados reais terminam antes de T0, então não alteram a fila
// (R-5). Os pedidos do teste são apagados no fim.
const T0 = new Date(Date.UTC(2099, 0, 1, 12, 0, 0));
const created: string[] = [];
// Dia da eleição longe de T0: os pedidos dos testes gerais são todos `standard`.
const FAR_ELECTION: ElectionDay = {
  date: '2098-10-25',
  startsAt: new Date('2098-10-25T03:00:00.000Z'),
  endsAt: new Date('2098-10-26T03:00:00.000Z'),
};

async function order(
  slot: SponsorshipSlot,
  minutes: number,
  now = T0,
  priceTier: PriceTier = 'standard',
): Promise<Sponsorship> {
  const id = randomUUID();
  const sponsorship = newPendingOrder({
    id,
    input: { slot, minutes, advertiserName: 'Teste Integração', email: 'int@exemplo.com' },
    quote: { priceTier, unitPriceCents: 100, amountCents: 100 * minutes },
    imageKey: `${id}.webp`,
    gateway: 'simulated',
    chargeId: `sim_${id}`,
    now,
    paymentTtlMinutes: 30,
  });
  await repository.create(sponsorship);
  created.push(id);
  return sponsorship;
}

describe('PrismaSponsorshipRepository (integração) — specs/sponsorships AC-07', () => {
  beforeAll(async () => {
    await prisma.$connect();
    // Isola a fila: nenhum `scheduled` de outra execução no ano do teste.
    await prisma.sponsorship.deleteMany({ where: { createdAt: { gte: T0 } } });
  });

  afterAll(async () => {
    await prisma.sponsorship.deleteMany({ where: { id: { in: created } } });
    await prisma.$disconnect();
  });

  it('confirmações simultâneas no mesmo local nunca se sobrepõem', async () => {
    const orders = await Promise.all([1, 2, 3, 4, 5].map((m) => order('glove_blue', m)));
    const outcomes = await Promise.all(
      orders.map((o) => repository.confirm(o.id, T0, FAR_ELECTION)),
    );

    const windows = outcomes
      .map((outcome) => {
        if (outcome.kind !== 'scheduled') throw new Error(`inesperado: ${outcome.kind}`);
        return outcome.sponsorship;
      })
      .sort((a, b) => a.startsAt!.getTime() - b.startsAt!.getTime());

    for (let i = 1; i < windows.length; i++) {
      expect(windows[i].startsAt!.getTime()).toBe(windows[i - 1].endsAt!.getTime());
    }
  });

  it('locais diferentes são independentes; confirmar de novo é idempotente', async () => {
    const floor = await order('floor', 2);
    const center = await order('center', 2);
    const [a, b] = await Promise.all([
      repository.confirm(floor.id, T0, FAR_ELECTION),
      repository.confirm(center.id, T0, FAR_ELECTION),
    ]);
    expect(a.kind === 'scheduled' && a.sponsorship.startsAt).toEqual(T0);
    expect(b.kind === 'scheduled' && b.sponsorship.startsAt).toEqual(T0);

    const again = await repository.confirm(
      floor.id,
      new Date(T0.getTime() + 5 * 60_000),
      FAR_ELECTION,
    );
    expect(again).toEqual(a);
  });

  it('vencido vira expired; inexistente → not_found; limpeza expira pendentes', async () => {
    const late = await order('side_left', 1);
    const after = new Date(T0.getTime() + 31 * 60_000);
    expect(await repository.confirm(late.id, after, FAR_ELECTION)).toEqual({ kind: 'expired' });
    expect((await repository.findById(late.id))?.status).toBe('expired');
    expect(await repository.confirm(randomUUID(), T0, FAR_ELECTION)).toEqual({ kind: 'not_found' });

    const pending = await order('side_right', 1);
    const expired = await repository.expirePending(after);
    expect(expired).toContainEqual({ id: pending.id, imageKey: `${pending.id}.webp` });
    await repository.clearImage(pending.id);
    expect(await repository.findById(pending.id)).toMatchObject({
      status: 'expired',
      imageKey: null,
    });
  });

  it('scheduleWindow e queueEnds leem só os scheduled', async () => {
    const o = await order('side_right', 3, T0);
    await repository.confirm(o.id, T0, FAR_ELECTION);
    const items = await repository.scheduleWindow(T0, new Date(T0.getTime() + 10 * 60_000));
    expect(items).toContainEqual({
      id: o.id,
      slot: 'side_right',
      startsAt: T0,
      endsAt: new Date(T0.getTime() + 3 * 60_000),
    });
    expect((await repository.queueEnds()).side_right?.getTime()).toBeGreaterThanOrEqual(
      T0.getTime() + 3 * 60_000,
    );
  });

  it('faixa mudou na confirmação → expired sem janela; reconfirmar → expired', async () => {
    // Dia da eleição começa 2 min depois de T0: 5 min a partir de T0 cruzam o início.
    const electionDay: ElectionDay = {
      date: '2099-01-01',
      startsAt: new Date(T0.getTime() + 2 * 60_000),
      endsAt: new Date(T0.getTime() + 24 * 60 * 60_000),
    };
    const cheap = await order('center', 5, T0, 'standard');
    // A fila do centro (de outro teste) termina no máximo em T0 + 2 min: a janela real toca o dia.

    expect(await repository.confirm(cheap.id, T0, electionDay)).toEqual({ kind: 'price_changed' });
    expect(await repository.findById(cheap.id)).toMatchObject({
      status: 'expired',
      startsAt: null,
      endsAt: null,
    });
    expect(await repository.confirm(cheap.id, T0, electionDay)).toEqual({ kind: 'expired' });

    const full = await order('center', 5, T0, 'election_day');
    const ok = await repository.confirm(full.id, T0, electionDay);
    expect(ok.kind).toBe('scheduled');
  });

  it('migration: pedidos anteriores a ela ficaram election_day e a coluna não tem default', async () => {
    const [migration] = await prisma.$queryRaw<{ finished_at: Date }[]>`
      SELECT finished_at FROM _prisma_migrations
      WHERE migration_name LIKE '%_sponsorship_price_tier'`;
    expect(migration).toBeDefined();
    const older = await prisma.sponsorship.groupBy({
      by: ['priceTier'],
      where: { createdAt: { lt: migration.finished_at } },
    });
    expect(older.every((group) => group.priceTier === 'election_day')).toBe(true);

    const [column] = await prisma.$queryRaw<{ column_default: string | null }[]>`
      SELECT column_default FROM information_schema.columns
      WHERE table_name = 'sponsorship' AND column_name = 'price_tier'`;
    expect(column.column_default).toBeNull();
  });
});
