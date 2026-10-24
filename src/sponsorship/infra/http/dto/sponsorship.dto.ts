// DTOs de documentação dos contratos de patrocínio (spec sponsorships FR-03;
// sponsorship-election-pricing FR-03; asaas-payment FR-03). Só anotações de Swagger; nenhuma
// resposta traz nome, e-mail ou CPF/CNPJ do anunciante (R-8).
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  MODERATION_CATEGORIES,
  type ModerationCategory,
} from '../../../../moderation/domain/categories';
import type { ModerationState } from '../../../domain/moderation-state';
import { SPONSORSHIP_SLOTS, type SponsorshipSlot } from '../../../domain/slots';
import type { PaymentMethod, RefundState } from '../../../domain/payment';
import type { PriceTier } from '../../../domain/pricing';
import type { SponsorshipStatus } from '../../../domain/scheduling';

const STATUSES: SponsorshipStatus[] = ['pending_payment', 'scheduled', 'expired'];
const PRICE_TIERS: PriceTier[] = ['standard', 'election_day'];
const GATEWAYS = ['simulated', 'asaas'];
const METHODS: PaymentMethod[] = ['pix', 'credit_card', 'other'];
const REFUNDS: Exclude<RefundState, 'none'>[] = ['requested', 'done', 'failed'];
const MODERATION_STATES: ModerationState[] = ['pending', 'approved', 'rejected', 'error'];

export class OfferSlotDto {
  @ApiProperty({ enum: SPONSORSHIP_SLOTS }) slot!: SponsorshipSlot;
  @ApiProperty({
    description:
      'Preço por minuto, em centavos, na faixa de um pedido de 1 minuto começando agora ou no fim da fila',
    example: 1500,
  })
  unitPriceCents!: number;
  @ApiProperty({ description: 'Preço por minuto no dia da eleição, em centavos', example: 300000 })
  electionDayUnitPriceCents!: number;
  @ApiProperty({ enum: PRICE_TIERS, description: 'Faixa de `unitPriceCents`' })
  priceTier!: PriceTier;
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Fim da fila do local (previsão); null se livre',
  })
  queueEndsAt!: string | null;
  @ApiProperty({
    description:
      'Minutos que ainda cabem no local antes do fim das vendas (previsão); 0 = esgotado',
    example: 60,
  })
  availableMinutes!: number;
}

export class OfferSalesDto {
  @ApiProperty({
    format: 'date-time',
    description: 'Fim das vendas: 00:00 do dia seguinte à eleição',
  })
  endsAt!: string;
  @ApiProperty({ description: 'true depois do fim das vendas' }) closed!: boolean;
}

export class ElectionDayDto {
  @ApiProperty({ example: '2026-10-25', description: 'Dia da eleição (America/Sao_Paulo)' })
  date!: string;
  @ApiProperty({ format: 'date-time', description: '00:00 do dia em São Paulo' }) startsAt!: string;
  @ApiProperty({ format: 'date-time', description: '00:00 do dia seguinte' }) endsAt!: string;
}

export class OfferPaymentDto {
  @ApiProperty({ enum: GATEWAYS }) gateway!: string;
  @ApiProperty({ description: 'true quando nenhuma cobrança real acontece (simulado ou sandbox)' })
  sandbox!: boolean;
  @ApiProperty({ enum: ['simulated', 'pix', 'credit_card'], isArray: true })
  methods!: string[];
}

export class SponsorOfferDto {
  @ApiProperty({
    description: 'false com gateway simulado em produção ou com as vendas encerradas',
  })
  available!: boolean;
  @ApiProperty({ example: 60 }) maxMinutes!: number;
  @ApiProperty({ format: 'date-time' }) serverTime!: string;
  @ApiProperty({ type: OfferPaymentDto }) payment!: OfferPaymentDto;
  @ApiProperty({ type: ElectionDayDto }) electionDay!: ElectionDayDto;
  @ApiProperty({ type: OfferSalesDto }) sales!: OfferSalesDto;
  @ApiProperty({ type: [OfferSlotDto] }) slots!: OfferSlotDto[];
}

export class PaymentInfoDto {
  @ApiProperty({ enum: GATEWAYS }) gateway!: string;
  @ApiProperty({ description: 'true quando nenhuma cobrança real acontece' }) sandbox!: boolean;
  @ApiProperty({ enum: METHODS, nullable: true, description: 'Forma com que foi pago' })
  method!: PaymentMethod | null;
  @ApiPropertyOptional({ format: 'date-time' }) paidAt?: string;
  @ApiProperty({
    enum: REFUNDS,
    nullable: true,
    description: 'Estorno de um pagamento que não pôde ser agendado; null se não há estorno',
  })
  refund!: Exclude<RefundState, 'none'> | null;
}

export class ModerationInfoDto {
  @ApiProperty({
    enum: MODERATION_STATES,
    description:
      'Decisão automática da moderação da imagem (sponsorship-image-moderation R-2). Nunca enviada ' +
      'pelo cliente; só pedido `approved` pode ser pago e exibido.',
  })
  status!: ModerationState;
  @ApiProperty({
    enum: MODERATION_CATEGORIES,
    isArray: true,
    description: 'Categorias da recusa (vazio fora de `rejected`)',
  })
  categories!: ModerationCategory[];
}

export class PublicSponsorshipDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: SPONSORSHIP_SLOTS }) slot!: SponsorshipSlot;
  @ApiProperty({ example: 2 }) minutes!: number;
  @ApiProperty({
    enum: PRICE_TIERS,
    description: 'Faixa de preço congelada no pedido (election_day = preço cheio)',
  })
  priceTier!: PriceTier;
  @ApiProperty({ example: 300000 }) unitPriceCents!: number;
  @ApiProperty({ example: 600000 }) amountCents!: number;
  @ApiProperty({ enum: STATUSES }) status!: SponsorshipStatus;
  @ApiProperty({ format: 'date-time' }) paymentExpiresAt!: string;
  @ApiProperty({ type: PaymentInfoDto }) payment!: PaymentInfoDto;
  @ApiProperty({ type: ModerationInfoDto }) moderation!: ModerationInfoDto;
  @ApiProperty({ type: String, nullable: true, description: 'Link opcional do anúncio' })
  linkUrl!: string | null;
  @ApiPropertyOptional({ format: 'date-time' }) confirmedAt?: string;
  @ApiPropertyOptional({ format: 'date-time' }) startsAt?: string;
  @ApiPropertyOptional({ format: 'date-time' }) endsAt?: string;
  @ApiPropertyOptional({ description: 'Minutos até entrar no ar, contados da confirmação' })
  startsInMinutes?: number;
}

export class CreateSponsorshipBodyDto {
  @ApiProperty({ type: 'string', format: 'binary', description: 'PNG, JPEG ou WebP' })
  image!: unknown;
  @ApiProperty({ enum: SPONSORSHIP_SLOTS }) slot!: string;
  @ApiProperty({ example: '2', description: 'Minutos inteiros (1…maxMinutes)' }) minutes!: string;
  @ApiProperty({ example: 'Padaria Central' }) advertiserName!: string;
  @ApiProperty({ example: 'contato@padaria.com.br' }) email!: string;
  @ApiProperty({
    example: '12.345.678/0001-95',
    description: 'CPF ou CNPJ do pagador, com ou sem pontuação (asaas-payment R-2)',
  })
  cpfCnpj!: string;
  @ApiPropertyOptional({
    example: 'https://padaria.com.br/promo',
    description: 'Link opcional do anúncio, http(s) (sponsor-link R-1)',
  })
  linkUrl?: string;
  @ApiProperty({ example: 'true' }) acceptTerms!: string;
}

export class PixInstructionsDto {
  @ApiProperty({ description: 'PNG do QR Code em base64' }) qrCodeImage!: string;
  @ApiProperty({ description: 'Código Pix copia-e-cola' }) payload!: string;
}

export class CardInstructionsDto {
  @ApiProperty({ type: String, nullable: true, description: 'Fatura hospedada do Asaas' })
  invoiceUrl!: string | null;
}

export class PaymentInstructionsDto {
  @ApiProperty({ enum: GATEWAYS }) gateway!: string;
  @ApiProperty() sandbox!: boolean;
  @ApiPropertyOptional({ format: 'date-time', description: 'Prazo de pagamento do pedido' })
  expiresAt?: string;
  @ApiPropertyOptional({ type: PixInstructionsDto }) pix?: PixInstructionsDto;
  @ApiPropertyOptional({ type: CardInstructionsDto }) card?: CardInstructionsDto;
}

export class ScheduleItemDto {
  @ApiProperty({ enum: SPONSORSHIP_SLOTS }) slot!: SponsorshipSlot;
  @ApiProperty({ format: 'uuid' }) sponsorshipId!: string;
  @ApiProperty({ format: 'uri' }) imageUrl!: string;
  @ApiProperty({ type: String, nullable: true, format: 'uri', description: 'Link do anúncio' })
  linkUrl!: string | null;
  @ApiProperty({ format: 'date-time' }) startsAt!: string;
  @ApiProperty({ format: 'date-time' }) endsAt!: string;
}

export class SponsorScheduleDto {
  @ApiProperty({ format: 'date-time' }) serverTime!: string;
  @ApiProperty({ format: 'date-time', description: 'Fim das vendas de patrocínio' })
  salesEndAt!: string;
  @ApiProperty({ type: [ScheduleItemDto] }) items!: ScheduleItemDto[];
}

export class SponsorshipErrorDto {
  @ApiProperty({
    enum: [
      'invalid_slot',
      'invalid_minutes',
      'invalid_image',
      'image_too_large',
      'invalid_advertiser',
      'invalid_email',
      'invalid_cpf_cnpj',
      'invalid_link_url',
      'terms_not_accepted',
      'expired',
      'price_changed',
      'sales_closed',
      'exceeds_sales_end',
      'already_paid',
      'gateway_error',
      'storage_error',
      'moderation_pending',
      'moderation_rejected',
      'moderation_error',
    ],
  })
  code!: string;
}

export class AsaasWebhookBodyDto {
  @ApiProperty({ example: 'evt_05b708f961d739ea7eba7e4db318f621&368604920' }) id!: string;
  @ApiProperty({ example: 'PAYMENT_RECEIVED' }) event!: string;
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'Cobrança do Asaas (id, status, value, billingType, externalReference…)',
  })
  payment?: Record<string, unknown>;
}

export class WebhookAckDto {
  @ApiProperty({ example: true }) received!: true;
}

export class WebhookErrorDto {
  @ApiProperty({ enum: ['unauthorized', 'invalid_event'] }) code!: string;
}
