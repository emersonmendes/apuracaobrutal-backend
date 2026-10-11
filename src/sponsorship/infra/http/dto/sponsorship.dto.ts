// DTOs de documentação dos contratos de patrocínio (spec sponsorships FR-03). Só anotações de
// Swagger; nenhuma resposta traz nome ou e-mail do anunciante (R-8).
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SPONSORSHIP_SLOTS, type SponsorshipSlot } from '../../../domain/slots';
import type { SponsorshipStatus } from '../../../domain/scheduling';

const STATUSES: SponsorshipStatus[] = ['pending_payment', 'scheduled', 'expired'];

export class OfferSlotDto {
  @ApiProperty({ enum: SPONSORSHIP_SLOTS }) slot!: SponsorshipSlot;
  @ApiProperty({ description: 'Preço por minuto, em centavos', example: 300000 })
  unitPriceCents!: number;
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Fim da fila do local (previsão); null se livre',
  })
  queueEndsAt!: string | null;
}

export class SponsorOfferDto {
  @ApiProperty({ description: 'false com gateway simulado em produção' }) available!: boolean;
  @ApiProperty({ example: 60 }) maxMinutes!: number;
  @ApiProperty({ format: 'date-time' }) serverTime!: string;
  @ApiProperty({ type: [OfferSlotDto] }) slots!: OfferSlotDto[];
}

export class PaymentInfoDto {
  @ApiProperty({ example: 'simulated' }) gateway!: string;
}

export class PublicSponsorshipDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: SPONSORSHIP_SLOTS }) slot!: SponsorshipSlot;
  @ApiProperty({ example: 2 }) minutes!: number;
  @ApiProperty({ example: 300000 }) unitPriceCents!: number;
  @ApiProperty({ example: 600000 }) amountCents!: number;
  @ApiProperty({ enum: STATUSES }) status!: SponsorshipStatus;
  @ApiProperty({ format: 'date-time' }) paymentExpiresAt!: string;
  @ApiProperty({ type: PaymentInfoDto }) payment!: PaymentInfoDto;
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
  @ApiProperty({ example: 'true' }) acceptTerms!: string;
}

export class ScheduleItemDto {
  @ApiProperty({ enum: SPONSORSHIP_SLOTS }) slot!: SponsorshipSlot;
  @ApiProperty({ format: 'uuid' }) sponsorshipId!: string;
  @ApiProperty({ format: 'uri' }) imageUrl!: string;
  @ApiProperty({ format: 'date-time' }) startsAt!: string;
  @ApiProperty({ format: 'date-time' }) endsAt!: string;
}

export class SponsorScheduleDto {
  @ApiProperty({ format: 'date-time' }) serverTime!: string;
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
      'terms_not_accepted',
      'expired',
    ],
  })
  code!: string;
}
