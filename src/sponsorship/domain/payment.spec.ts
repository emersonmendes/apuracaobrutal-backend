import {
  REFUND_MAX_ATTEMPTS,
  amountCentsFromValue,
  expiryWrites,
  methodFromBillingType,
  nextRefundState,
  paymentMatches,
  scheduleWrites,
} from './payment';

const NOW = new Date('2026-10-25T23:05:00.000Z');
const received = { chargeId: 'pay_1', amountCents: 12_990, method: 'pix' as const };
const untouched = {
  expiryReason: null,
  refund: 'none' as const,
  paidAt: null,
  paymentMethod: null,
};

describe('pagamento recebido — spec asaas-payment R-5 (AC-07)', () => {
  it('traduz billingType e valor em reais para centavos', () => {
    expect(methodFromBillingType('PIX')).toBe('pix');
    expect(methodFromBillingType('CREDIT_CARD')).toBe('credit_card');
    expect(methodFromBillingType('BOLETO')).toBe('other');
    expect(methodFromBillingType(undefined)).toBe('other');
    expect(amountCentsFromValue(129.9)).toBe(12_990);
    expect(amountCentsFromValue(5)).toBe(500);
    expect(amountCentsFromValue(0.1 + 0.2)).toBe(30);
    expect(amountCentsFromValue('129.9')).toBeNull();
    expect(amountCentsFromValue(Number.NaN)).toBeNull();
  });

  it('confere cobrança e valor', () => {
    const order = { chargeId: 'pay_1', amountCents: 12_990 };
    expect(paymentMatches(order, received)).toBe(true);
    expect(paymentMatches(order, { ...received, chargeId: 'pay_2' })).toBe(false);
    expect(paymentMatches(order, { ...received, amountCents: 12_980 })).toBe(false);
  });

  it('expirar com pagamento recebido pede estorno e registra o pagamento', () => {
    expect(expiryWrites(untouched, 'payment_timeout', received, NOW)).toEqual({
      status: 'expired',
      expiryReason: 'payment_timeout',
      refund: 'requested',
      paidAt: NOW,
      paymentMethod: 'pix',
    });
    expect(expiryWrites(untouched, 'price_changed', received, NOW).expiryReason).toBe(
      'price_changed',
    );
  });

  it('expirar sem pagamento (ação simulada ou limpeza) não pede estorno', () => {
    expect(expiryWrites(untouched, 'payment_timeout', undefined, NOW)).toEqual({
      status: 'expired',
      expiryReason: 'payment_timeout',
      refund: 'none',
      paidAt: null,
      paymentMethod: null,
    });
  });

  it('segunda notificação não regride um estorno nem o motivo original', () => {
    const paid = new Date('2026-10-25T23:00:00.000Z');
    const order = {
      expiryReason: 'price_changed' as const,
      refund: 'done' as const,
      paidAt: paid,
      paymentMethod: 'credit_card' as const,
    };
    expect(expiryWrites(order, 'payment_timeout', received, NOW)).toEqual({
      status: 'expired',
      expiryReason: 'price_changed',
      refund: 'done',
      paidAt: paid,
      paymentMethod: 'credit_card',
    });
  });

  it('agendar com pagamento real grava paidAt e a forma; simulado não', () => {
    const window = { startsAt: NOW, endsAt: new Date(NOW.getTime() + 60_000) };
    expect(scheduleWrites(window, received, NOW)).toEqual({
      status: 'scheduled',
      confirmedAt: NOW,
      ...window,
      paidAt: NOW,
      paymentMethod: 'pix',
    });
    expect(scheduleWrites(window, undefined, NOW)).toEqual({
      status: 'scheduled',
      confirmedAt: NOW,
      ...window,
    });
  });
});

describe('estorno — spec asaas-payment R-7 (AC-09)', () => {
  it('sucesso → done; falha continua requested até a 20ª, que vira failed', () => {
    expect(nextRefundState(1, true)).toBe('done');
    expect(nextRefundState(1, false)).toBe('requested');
    expect(nextRefundState(REFUND_MAX_ATTEMPTS - 1, false)).toBe('requested');
    expect(nextRefundState(REFUND_MAX_ATTEMPTS, false)).toBe('failed');
    expect(nextRefundState(REFUND_MAX_ATTEMPTS, true)).toBe('done');
  });
});
