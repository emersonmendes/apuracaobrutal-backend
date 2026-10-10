import { Controller, Get, Res, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { ElectionFeedResponse } from '../../domain/election-snapshot';
import { ElectionFeedResponseDto } from './dto/election-feed.dto';
import { FeedPublisher, feedMessage, type SseClient } from './feed-publisher';

/** Feed público da home (spec election-results-feed FR-07). Controller fino: só delega. */
@ApiTags('election-feed')
@Controller('election-feed')
export class ElectionFeedController {
  constructor(private readonly publisher: FeedPublisher) {}

  @Get()
  @ApiOperation({ summary: 'Feed atual da apuração (snapshot da home + saúde da fonte oficial)' })
  @ApiResponse({ status: 200, type: ElectionFeedResponseDto })
  async getFeed(): Promise<ElectionFeedResponse> {
    return (await this.publisher.currentFeed()).feed;
  }

  @Get('stream')
  @ApiOperation({
    summary: 'Stream SSE do feed',
    description:
      'Envia `event: feed` (id = versão do feed) ao conectar e a cada mudança; comentário ' +
      '`: ping` a cada 15 s.',
  })
  @ApiProduces('text/event-stream')
  @ApiResponse({
    status: 200,
    description: 'Stream `text/event-stream` de `ElectionFeedResponse`.',
  })
  @ApiResponse({ status: 503, description: 'Limite de conexões SSE atingido.' })
  async stream(@Res() res: Response): Promise<void> {
    const client: SseClient = {
      write: (chunk) => void res.write(chunk),
      pendingBytes: () => res.writableLength,
      close: () => res.destroy(),
    };
    if (!this.publisher.addClient(client)) {
      throw new ServiceUnavailableException('Limite de conexões SSE atingido');
    }
    res.on('close', () => this.publisher.removeClient(client));

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      res.write(feedMessage(await this.publisher.currentFeed()));
    } catch {
      this.publisher.removeClient(client);
      res.end();
    }
  }
}
