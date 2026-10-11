import type { PaymentMethod } from '../payment';
import type { PaymentGatewayName } from '../sponsorship-config';

/** Dados do pagador enviados ao gateway (asaas-payment R-2, R-3). Nunca voltam em respostas. */
export interface ChargePayer {
  name: string;
  email: string;
  /** Só dígitos. */
  cpfCnpj: string;
}

export interface CreateChargeArgs {
  sponsorshipId: string;
  amountCents: number;
  description: string;
  /** `AAAA-MM-DD` no fuso comercial (R-3). */
  dueDate: string;
  payer: ChargePayer;
}

export interface CreatedCharge {
  chargeId: string;
  customerId: string | null;
  invoiceUrl: string | null;
}

export interface PixQrCode {
  /** PNG em base64. */
  qrCodeImage: string;
  /** Código copia-e-cola. */
  payload: string;
}

export type ChargeState = 'pending' | 'paid' | 'refunded' | 'cancelled' | 'other';

export interface ChargeStatus {
  state: ChargeState;
  method: PaymentMethod | null;
}

/**
 * Porta de cobrança (spec sponsorships R-9; asaas-payment FR-04). Adapters: `simulated` (sem
 * efeito externo) e `asaas`. O adapter só traduz protocolo; nenhuma regra mora aqui.
 */
export interface PaymentGateway {
  readonly name: PaymentGatewayName;
  /** `true` quando nenhuma cobrança real acontece (simulado ou sandbox). */
  readonly sandbox: boolean;
  createCharge(args: CreateChargeArgs): Promise<CreatedCharge>;
  getPixQrCode(chargeId: string): Promise<PixQrCode>;
  getChargeStatus(chargeId: string): Promise<ChargeStatus>;
  refund(
    chargeId: string,
    amountCents: number,
    reason: string,
  ): Promise<{ state: 'done' | 'already_refunded' }>;
  cancelCharge(chargeId: string): Promise<void>;
}

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');
