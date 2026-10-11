import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ConfirmPayment } from '../../application/confirm-payment';
import { CreateSponsorship } from '../../application/create-sponsorship';
import { GetOffer, type SponsorOffer } from '../../application/get-offer';
import { GetSchedule } from '../../application/get-schedule';
import { GetSponsorship } from '../../application/get-sponsorship';
import type { PublicSponsorship } from '../../application/public-sponsorship';
import { ReadSponsorImage } from '../../application/read-sponsor-image';
import type { RawOrderInput } from '../../domain/validation';
import {
  CreateSponsorshipBodyDto,
  PublicSponsorshipDto,
  SponsorOfferDto,
  SponsorScheduleDto,
  SponsorshipErrorDto,
} from './dto/sponsorship.dto';
import { SponsorshipErrorFilter } from './sponsorship-error.filter';

/** `:id` malformado responde 404, como um id inexistente (FR-03). */
const idPipe = new ParseUUIDPipe({ version: '4', errorHttpStatusCode: 404 });

/** Campos multipart crus: validados no domínio (R-3, R-8), não pelo ValidationPipe. */
type MultipartFields = Record<string, unknown>;

/**
 * Patrocínios na arena (spec sponsorships FR-03). Controller fino: lê a requisição, delega ao caso
 * de uso e mapeia a resposta. Nunca loga o corpo do POST (R-8).
 */
@ApiTags('sponsorships')
@Controller('sponsorships')
@UseFilters(SponsorshipErrorFilter)
export class SponsorshipsController {
  constructor(
    private readonly getOffer: GetOffer,
    private readonly createSponsorship: CreateSponsorship,
    private readonly confirmPayment: ConfirmPayment,
    private readonly getSponsorship: GetSponsorship,
    private readonly getSchedule: GetSchedule,
    private readonly readImage: ReadSponsorImage,
  ) {}

  @Get('offer')
  @ApiOperation({ summary: 'Preço por minuto e fila de cada local de patrocínio' })
  @ApiResponse({ status: 200, type: SponsorOfferDto })
  offer(): Promise<SponsorOffer> {
    return this.getOffer.execute();
  }

  @Get('schedule')
  @ApiOperation({
    summary: 'Agenda de patrocínios no ar e dos próximos 10 minutos',
    description: 'Somente pedidos pagos; usada pela arena para trocar as imagens nos horários.',
  })
  @ApiResponse({ status: 200, type: SponsorScheduleDto })
  async schedule(@Req() req: Request) {
    const { serverTime, items } = await this.getSchedule.execute();
    const base = `${req.protocol}://${req.get('host')}`;
    return {
      serverTime,
      items: items.map((item) => ({
        slot: item.slot,
        sponsorshipId: item.id,
        imageUrl: `${base}/sponsorships/${item.id}/image`,
        startsAt: item.startsAt,
        endsAt: item.endsAt,
      })),
    };
  }

  @Post()
  @UseGuards(ThrottlerGuard)
  @UseInterceptors(FileInterceptor('image'))
  @ApiOperation({ summary: 'Cria um pedido de patrocínio aguardando pagamento' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: CreateSponsorshipBodyDto })
  @ApiResponse({ status: 201, type: PublicSponsorshipDto })
  @ApiResponse({ status: 400, type: SponsorshipErrorDto, description: 'Campo ou imagem inválidos' })
  @ApiResponse({ status: 429, description: 'Limite de pedidos por IP atingido' })
  @ApiResponse({ status: 503, description: 'Compra indisponível (gateway simulado em produção)' })
  create(
    @Body() body: MultipartFields,
    @UploadedFile() image: Express.Multer.File | undefined,
  ): Promise<PublicSponsorship> {
    const raw: RawOrderInput = {
      slot: body.slot,
      minutes: body.minutes,
      advertiserName: body.advertiserName,
      email: body.email,
      acceptTerms: body.acceptTerms,
    };
    return this.createSponsorship.execute(raw, image?.buffer);
  }

  @Post(':id/simulated-payment')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Confirma o pagamento SIMULADO e agenda o patrocínio',
    description: 'Idempotente. Nenhuma cobrança real; indisponível em produção.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: PublicSponsorshipDto })
  @ApiResponse({ status: 404, description: 'Pedido inexistente' })
  @ApiResponse({
    status: 409,
    type: SponsorshipErrorDto,
    description:
      'expired: prazo de pagamento vencido · price_changed: a janela no ar mudou de faixa de preço ' +
      '(dia da eleição) desde a criação; o pedido expira e deve ser refeito',
  })
  @ApiResponse({ status: 503, description: 'Compra indisponível (gateway simulado em produção)' })
  simulatedPayment(@Param('id', idPipe) id: string): Promise<PublicSponsorship> {
    return this.confirmPayment.execute(id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Pedido de patrocínio (visão pública)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: PublicSponsorshipDto })
  @ApiResponse({ status: 404, description: 'Pedido inexistente' })
  find(@Param('id', idPipe) id: string): Promise<PublicSponsorship> {
    return this.getSponsorship.execute(id);
  }

  @Get(':id/image')
  @ApiOperation({ summary: 'Imagem reprocessada (WebP) de um patrocínio pago' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiProduces('image/webp')
  @ApiResponse({ status: 200, description: 'Imagem WebP' })
  @ApiResponse({ status: 404, description: 'Inexistente, não pago ou sem imagem' })
  async image(@Param('id', idPipe) id: string, @Res() res: Response): Promise<void> {
    const bytes = await this.readImage.execute(id);
    res
      .status(200)
      .set({
        'Content-Type': 'image/webp',
        'Cache-Control': 'public, max-age=86400, immutable',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(bytes);
  }
}
