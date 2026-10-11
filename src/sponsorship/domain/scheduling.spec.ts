import {
  confirmationTierMatches,
  effectiveStatus,
  newPendingOrder,
  schedule,
  startsInMinutes,
} from './scheduling';

const t = new Date('2026-10-25T23:00:00.000Z');
const at = (iso: string) => new Date(iso);

describe('agendamento — spec sponsorships R-4, R-5, R-6 (AC-05, AC-06)', () => {
  it('pedido novo nasce pendente, com preço congelado e validade do pagamento', () => {
    const order = newPendingOrder({
      id: 'id',
      input: {
        slot: 'floor',
        minutes: 2,
        advertiserName: 'Ana',
        email: 'a@b.co',
        cpfCnpj: '52998224725',
      },
      quote: { priceTier: 'election_day', unitPriceCents: 500_000, amountCents: 1_000_000 },
      imageSha256: 'a'.repeat(64),
      imageKey: 'id.webp',
      gateway: 'simulated',
      chargeId: 'sim_1',
      now: t,
      paymentTtlMinutes: 30,
    });
    expect(order).toMatchObject({
      status: 'pending_payment',
      priceTier: 'election_day',
      unitPriceCents: 500_000,
      amountCents: 1_000_000,
      paymentExpiresAt: at('2026-10-25T23:30:00.000Z'),
      startsAt: null,
    });
  });

  it('local livre: entra no ar no instante do pagamento ("já está no ar")', () => {
    const window = schedule(t, 5, null);
    expect(window).toEqual({ startsAt: t, endsAt: at('2026-10-25T23:05:00.000Z') });
    expect(startsInMinutes(t, window.startsAt)).toBe(0);
  });

  it('local com fila: entra no fim da fila', () => {
    const queueEnd = at('2026-10-25T23:07:30.000Z');
    const window = schedule(t, 2, queueEnd);
    expect(window.startsAt).toEqual(queueEnd);
    expect(window.endsAt).toEqual(at('2026-10-25T23:09:30.000Z'));
    expect(startsInMinutes(t, window.startsAt)).toBe(8);
  });

  it('fila já encerrada não atrasa nem antecipa: entra agora', () => {
    expect(schedule(t, 1, at('2026-10-25T22:59:30.000Z')).startsAt).toEqual(t);
  });

  it('pendente vencido é visto como expired; scheduled não muda', () => {
    const paymentExpiresAt = at('2026-10-25T23:30:00.000Z');
    expect(effectiveStatus({ status: 'pending_payment', paymentExpiresAt }, t)).toBe(
      'pending_payment',
    );
    expect(effectiveStatus({ status: 'pending_payment', paymentExpiresAt }, paymentExpiresAt)).toBe(
      'expired',
    );
    expect(effectiveStatus({ status: 'scheduled', paymentExpiresAt }, at('2027-01-01'))).toBe(
      'scheduled',
    );
  });
});

describe('confirmationTierMatches — spec sponsorship-election-pricing R-5 (AC-06)', () => {
  const electionDay = {
    startsAt: at('2026-10-25T03:00:00.000Z'),
    endsAt: at('2026-10-26T03:00:00.000Z'),
  };
  const crossing = schedule(at('2026-10-25T02:58:00.000Z'), 5, null);
  const before = schedule(at('2026-10-25T01:00:00.000Z'), 5, null);
  const after = schedule(at('2026-10-26T03:00:00.000Z'), 5, null);

  it('faixa igual → confirma', () => {
    expect(confirmationTierMatches({ priceTier: 'standard' }, before, electionDay)).toBe(true);
    expect(confirmationTierMatches({ priceTier: 'election_day' }, crossing, electionDay)).toBe(
      true,
    );
  });

  it('faixa diferente, nas duas direções → recusa', () => {
    expect(confirmationTierMatches({ priceTier: 'standard' }, crossing, electionDay)).toBe(false);
    expect(confirmationTierMatches({ priceTier: 'election_day' }, after, electionDay)).toBe(false);
  });
});
