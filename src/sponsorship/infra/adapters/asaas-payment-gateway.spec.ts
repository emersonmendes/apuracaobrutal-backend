import { GatewayError } from '../../domain/errors';
import { asaasConfig, TEST_CPF } from '../../application/__fakes__/fixtures';
import { AsaasPaymentGateway } from './asaas-payment-gateway';

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/** `fetch` falso roteado por `método caminho`; responde 404 ao que não conhece. */
function fakeFetch(routes: Record<string, { status?: number; body?: unknown } | (() => never)>) {
  const calls: Call[] = [];
  const fn = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const path = url.replace('https://api-sandbox.asaas.com/v3', '');
    calls.push({
      method,
      url,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const route = routes[`${method} ${path}`];
    if (typeof route === 'function') route();
    const { status = 200, body = {} } = (route as
      { status?: number; body?: unknown } | undefined) ?? {
      status: 404,
      body: {},
    };
    return { ok: status < 400, status, json: async () => body } as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const args = {
  sponsorshipId: '3f0e8a52-6c1e-4f0a-9d3b-2a1b4c5d6e7f',
  amountCents: 12_990,
  description: 'Patrocínio center — 2 min',
  dueDate: '2026-10-25',
  payer: { name: 'Padaria Central', email: 'contato@padaria.com.br', cpfCnpj: TEST_CPF },
};

describe('AsaasPaymentGateway — spec asaas-payment R-3, R-4, R-7, R-8 (AC-12)', () => {
  it('cria cliente e cobrança UNDEFINED com valor em reais, autenticado pela chave', async () => {
    const { fn, calls } = fakeFetch({
      'POST /customers': { body: { id: 'cus_1' } },
      'POST /payments': { body: { id: 'pay_1', invoiceUrl: 'https://sandbox.asaas.com/i/1' } },
    });
    const gateway = new AsaasPaymentGateway(asaasConfig(), fn);
    expect(gateway.sandbox).toBe(true);
    await expect(gateway.createCharge(args)).resolves.toEqual({
      chargeId: 'pay_1',
      customerId: 'cus_1',
      invoiceUrl: 'https://sandbox.asaas.com/i/1',
    });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'POST https://api-sandbox.asaas.com/v3/customers',
      'POST https://api-sandbox.asaas.com/v3/payments',
    ]);
    expect(calls[0].headers.access_token).toBe('$aact_test_key');
    expect(calls[0].body).toEqual({
      name: 'Padaria Central',
      cpfCnpj: TEST_CPF,
      email: 'contato@padaria.com.br',
      notificationDisabled: true,
      externalReference: args.sponsorshipId,
    });
    expect(calls[1].body).toEqual({
      customer: 'cus_1',
      billingType: 'UNDEFINED',
      value: 129.9,
      dueDate: '2026-10-25',
      description: 'Patrocínio center — 2 min',
      externalReference: args.sponsorshipId,
    });
  });

  it('cria um cliente novo a cada pedido, sem reutilizar nem atualizar o do mesmo CPF/CNPJ', async () => {
    const { fn, calls } = fakeFetch({
      'POST /customers': { body: { id: 'cus_new' } },
      'POST /payments': { body: { id: 'pay_2' } },
    });
    const created = await new AsaasPaymentGateway(asaasConfig(), fn).createCharge(args);
    expect(created).toEqual({ chargeId: 'pay_2', customerId: 'cus_new', invoiceUrl: null });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'POST https://api-sandbox.asaas.com/v3/customers',
      'POST https://api-sandbox.asaas.com/v3/payments',
    ]);
  });

  it('usa a URL base de produção quando configurado', async () => {
    const { fn, calls } = fakeFetch({});
    const gateway = new AsaasPaymentGateway(
      asaasConfig({ environment: 'production', baseUrl: 'https://api.asaas.com/v3' }),
      fn,
    );
    expect(gateway.sandbox).toBe(false);
    await expect(gateway.cancelCharge('pay_1')).rejects.toBeInstanceOf(GatewayError);
    expect(calls[0].url).toBe('https://api.asaas.com/v3/payments/pay_1');
  });

  it('QR Code Pix: encodedImage/payload; resposta incompleta é erro', async () => {
    const { fn } = fakeFetch({
      'GET /payments/pay_1/pixQrCode': { body: { encodedImage: 'iVBOR', payload: '000201' } },
      'GET /payments/pay_2/pixQrCode': { body: { success: true } },
    });
    const gateway = new AsaasPaymentGateway(asaasConfig(), fn);
    await expect(gateway.getPixQrCode('pay_1')).resolves.toEqual({
      qrCodeImage: 'iVBOR',
      payload: '000201',
    });
    await expect(gateway.getPixQrCode('pay_2')).rejects.toBeInstanceOf(GatewayError);
  });

  it.each([
    ['PENDING', 'PIX', false, 'pending', null],
    ['OVERDUE', 'PIX', false, 'pending', null],
    ['CONFIRMED', 'CREDIT_CARD', false, 'paid', 'credit_card'],
    ['RECEIVED', 'PIX', false, 'paid', 'pix'],
    ['RECEIVED_IN_CASH', 'UNDEFINED', false, 'paid', 'other'],
    ['REFUNDED', 'PIX', false, 'refunded', 'pix'],
    ['REFUND_REQUESTED', 'PIX', false, 'refunded', 'pix'],
    ['REFUND_IN_PROGRESS', 'PIX', false, 'refunded', 'pix'],
    ['PENDING', 'PIX', true, 'cancelled', 'pix'],
    ['AWAITING_RISK_ANALYSIS', 'CREDIT_CARD', false, 'other', 'credit_card'],
  ])('status %s/%s (deleted=%s) → %s', async (status, billingType, deleted, state, method) => {
    const { fn } = fakeFetch({ 'GET /payments/pay_1': { body: { status, billingType, deleted } } });
    await expect(
      new AsaasPaymentGateway(asaasConfig(), fn).getChargeStatus('pay_1'),
    ).resolves.toEqual({ state, method });
  });

  it('estorno: integral com motivo; já estornado → already_refunded', async () => {
    const { fn, calls } = fakeFetch({
      'GET /payments/pay_1': { body: { status: 'CONFIRMED', billingType: 'PIX' } },
      'POST /payments/pay_1/refund': { body: { status: 'REFUNDED' } },
      'GET /payments/pay_2': { body: { status: 'REFUNDED', billingType: 'PIX' } },
    });
    const gateway = new AsaasPaymentGateway(asaasConfig(), fn);
    await expect(gateway.refund('pay_1', 12_990, 'Patrocínio não agendado')).resolves.toEqual({
      state: 'done',
    });
    expect(calls[1].body).toEqual({ value: 129.9, description: 'Patrocínio não agendado' });
    await expect(gateway.refund('pay_2', 12_990, 'x')).resolves.toEqual({
      state: 'already_refunded',
    });
    expect(calls).toHaveLength(3);
  });

  it('cancelamento: DELETE na cobrança', async () => {
    const { fn, calls } = fakeFetch({ 'DELETE /payments/pay_1': { body: { deleted: true } } });
    await new AsaasPaymentGateway(asaasConfig(), fn).cancelCharge('pay_1');
    expect(calls[0]).toMatchObject({ method: 'DELETE' });
  });

  it('HTTP ≠ 2xx vira GatewayError com status e código, sem a chave', async () => {
    const { fn } = fakeFetch({
      'GET /payments/pay_1': {
        status: 401,
        body: { errors: [{ code: 'invalid_access_token', description: 'chave inválida' }] },
      },
    });
    const gateway = new AsaasPaymentGateway(asaasConfig(), fn);
    const error = await gateway.getChargeStatus('pay_1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GatewayError);
    expect(error as GatewayError).toMatchObject({
      status: 401,
      gatewayCode: 'invalid_access_token',
    });
    expect((error as Error).message).not.toContain('$aact_test_key');
    expect((error as Error).message).not.toContain('chave inválida');
  });

  it('erro ao criar o cliente não leva o CPF/CNPJ na mensagem (A-1, R-2)', async () => {
    const { fn } = fakeFetch({
      'POST /customers': { status: 500, body: {} },
    });
    const error = await new AsaasPaymentGateway(asaasConfig(), fn)
      .createCharge(args)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GatewayError);
    expect((error as Error).message).not.toContain(TEST_CPF);
    expect((error as Error).message).toContain('POST /customers');
  });

  it('timeout ou rede fora viram GatewayError', async () => {
    const { fn } = fakeFetch({
      'GET /payments/pay_1': () => {
        throw Object.assign(new Error('aborted'), { name: 'TimeoutError' });
      },
    });
    const error = await new AsaasPaymentGateway(asaasConfig(), fn)
      .getChargeStatus('pay_1')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GatewayError);
    expect((error as Error).message).toContain('TimeoutError');
  });

  it('envia o timeout configurado como AbortSignal', async () => {
    const { fn } = fakeFetch({ 'GET /payments/pay_1': { body: { status: 'PENDING' } } });
    await new AsaasPaymentGateway(asaasConfig({ timeoutMs: 1_234 }), fn).getChargeStatus('pay_1');
    const init = (fn as jest.Mock).mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
