import { effectiveStatus, newPendingOrder, schedule, startsInMinutes } from './scheduling';

const t = new Date('2026-10-25T23:00:00.000Z');
const at = (iso: string) => new Date(iso);

describe('agendamento — spec sponsorships R-4, R-5, R-6 (AC-05, AC-06)', () => {
  it('pedido novo nasce pendente, com preço congelado e validade do pagamento', () => {
    const order = newPendingOrder({
      id: 'id',
      input: { slot: 'floor', minutes: 2, advertiserName: 'Ana', email: 'a@b.co' },
      quote: { unitPriceCents: 500_000, amountCents: 1_000_000 },
      imageKey: 'id.webp',
      gateway: 'simulated',
      chargeId: 'sim_1',
      now: t,
      paymentTtlMinutes: 30,
    });
    expect(order).toMatchObject({
      status: 'pending_payment',
      unitPriceCents: 500_000,
      amountCents: 1_000_000,
      paymentExpiresAt: at('2026-10-25T23:30:00.000Z'),
      startsAt: null,
    });
  });

  it('local livre: entra em agora + LEAD e "entra em 1 minuto"', () => {
    const window = schedule(t, 5, null, 60);
    expect(window).toEqual({
      startsAt: at('2026-10-25T23:01:00.000Z'),
      endsAt: at('2026-10-25T23:06:00.000Z'),
    });
    expect(startsInMinutes(t, window.startsAt)).toBe(1);
  });

  it('local com fila: entra no fim da fila', () => {
    const queueEnd = at('2026-10-25T23:07:30.000Z');
    const window = schedule(t, 2, queueEnd, 60);
    expect(window.startsAt).toEqual(queueEnd);
    expect(window.endsAt).toEqual(at('2026-10-25T23:09:30.000Z'));
    expect(startsInMinutes(t, window.startsAt)).toBe(8);
  });

  it('fila que termina antes de agora + LEAD não antecipa a entrada', () => {
    expect(schedule(t, 1, at('2026-10-25T23:00:30.000Z'), 60).startsAt).toEqual(
      at('2026-10-25T23:01:00.000Z'),
    );
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
