import { GatewayError } from '../../domain/errors';
import { methodFromBillingType } from '../../domain/payment';
import type {
  ChargeState,
  ChargeStatus,
  CreateChargeArgs,
  CreatedCharge,
  PaymentGateway,
  PixQrCode,
} from '../../domain/ports/payment-gateway';
import type { AsaasConfig } from '../../domain/sponsorship-config';

type FetchFn = typeof fetch;
type Json = Record<string, unknown>;

/** `status` da cobrança no Asaas → estado da porta (spec asaas-payment FR-04, AC-12). */
const STATE_BY_STATUS: Record<string, ChargeState> = {
  PENDING: 'pending',
  OVERDUE: 'pending',
  CONFIRMED: 'paid',
  RECEIVED: 'paid',
  RECEIVED_IN_CASH: 'paid',
  REFUNDED: 'refunded',
  REFUND_REQUESTED: 'refunded',
  REFUND_IN_PROGRESS: 'refunded',
};

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Adapter do Asaas (spec asaas-payment R-3, R-4, R-7, R-8). Só traduz protocolo: autenticação,
 * URLs, formatos e códigos de status. Nenhuma regra de negócio; nenhum erro carrega a chave de
 * API nem o corpo enviado (dados do pagador).
 */
export class AsaasPaymentGateway implements PaymentGateway {
  readonly name = 'asaas' as const;
  readonly sandbox: boolean;

  constructor(
    private readonly config: AsaasConfig,
    private readonly fetchFn: FetchFn = (...args) => globalThis.fetch(...args),
  ) {
    this.sandbox = config.environment === 'sandbox';
  }

  async createCharge(args: CreateChargeArgs): Promise<CreatedCharge> {
    const customerId = await this.createCustomer(args);
    const payment = await this.request('POST', '/payments', {
      customer: customerId,
      billingType: 'UNDEFINED',
      value: Number((args.amountCents / 100).toFixed(2)),
      dueDate: args.dueDate,
      description: args.description,
      externalReference: args.sponsorshipId,
    });
    const chargeId = payment.id;
    if (typeof chargeId !== 'string' || chargeId === '') {
      throw new GatewayError('Asaas não devolveu o id da cobrança');
    }
    return {
      chargeId,
      customerId,
      invoiceUrl: typeof payment.invoiceUrl === 'string' ? payment.invoiceUrl : null,
    };
  }

  async getPixQrCode(chargeId: string): Promise<PixQrCode> {
    const body = await this.request('GET', `/payments/${encodeURIComponent(chargeId)}/pixQrCode`);
    if (typeof body.encodedImage !== 'string' || typeof body.payload !== 'string') {
      throw new GatewayError('Asaas não devolveu o QR Code Pix');
    }
    return { qrCodeImage: body.encodedImage, payload: body.payload };
  }

  async getChargeStatus(chargeId: string): Promise<ChargeStatus> {
    const body = await this.request('GET', `/payments/${encodeURIComponent(chargeId)}`);
    const state: ChargeState =
      body.deleted === true
        ? 'cancelled'
        : (STATE_BY_STATUS[typeof body.status === 'string' ? body.status : ''] ?? 'other');
    return { state, method: state === 'pending' ? null : methodFromBillingType(body.billingType) };
  }

  async refund(
    chargeId: string,
    amountCents: number,
    reason: string,
  ): Promise<{ state: 'done' | 'already_refunded' }> {
    if ((await this.getChargeStatus(chargeId)).state === 'refunded') {
      return { state: 'already_refunded' };
    }
    await this.request('POST', `/payments/${encodeURIComponent(chargeId)}/refund`, {
      value: Number((amountCents / 100).toFixed(2)),
      description: reason,
    });
    return { state: 'done' };
  }

  async cancelCharge(chargeId: string): Promise<void> {
    await this.request('DELETE', `/payments/${encodeURIComponent(chargeId)}`);
  }

  /**
   * Cria um cliente por pedido (asaas-payment R-3): o nome pertence ao cliente no Asaas, então
   * reutilizar/atualizar um cliente com o mesmo CPF/CNPJ trocaria o nome das cobranças anteriores.
   */
  private async createCustomer(args: CreateChargeArgs): Promise<string> {
    const created = await this.request('POST', '/customers', {
      name: args.payer.name,
      cpfCnpj: args.payer.cpfCnpj,
      email: args.payer.email,
      notificationDisabled: true,
      externalReference: args.sponsorshipId,
    });
    if (typeof created.id !== 'string')
      throw new GatewayError('Asaas não devolveu o id do cliente');
    return created.id;
  }

  /**
   * Chamada autenticada com timeout; qualquer falha vira `GatewayError` sem dados sensíveis: as
   * mensagens levam só método e recurso, nunca a query string (pode carregar o CPF/CNPJ).
   */
  private async request(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: Json,
  ): Promise<Json> {
    const url = `${this.config.baseUrl}${path}`;
    const resource = path.split('?')[0];
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method,
        headers: {
          accept: 'application/json',
          access_token: this.config.apiKey,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : 'erro';
      throw new GatewayError(`Asaas indisponível em ${method} ${resource} (${name})`);
    }

    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }
    if (!response.ok) {
      throw new GatewayError(
        `Asaas respondeu ${response.status} em ${method} ${resource}`,
        response.status,
        firstErrorCode(parsed),
      );
    }
    if (!isObject(parsed)) {
      throw new GatewayError(`Asaas respondeu sem JSON em ${method} ${resource}`);
    }
    return parsed;
  }
}

/** `{ errors: [{ code }] }` do Asaas → código do primeiro erro (nunca a descrição). */
function firstErrorCode(body: unknown): string | null {
  if (!isObject(body) || !Array.isArray(body.errors)) return null;
  const first = body.errors[0];
  return isObject(first) && typeof first.code === 'string' ? first.code : null;
}
