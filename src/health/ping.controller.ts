import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

/** Health check público. Spec: /specs/backend-bootstrap (FR-01, R-1, R-2). */
@ApiTags('health')
@Controller()
export class PingController {
  @Get('ping')
  @Header('Content-Type', 'text/plain')
  @ApiOperation({ summary: 'Health check — confirma que o processo da API está no ar' })
  @ApiResponse({
    status: 200,
    description: 'Serviço no ar.',
    content: { 'text/plain': { schema: { type: 'string', example: 'pong' } } },
  })
  ping(): string {
    return 'pong';
  }
}
