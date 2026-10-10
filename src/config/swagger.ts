import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

/** Monta o documento OpenAPI a partir dos decorators da aplicação. */
export function createSwaggerDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('apuracaobrutal backend')
    .setDescription('API do Apuração Brutal — documentação de desenvolvimento')
    .setVersion('0.0.1')
    .build();

  return SwaggerModule.createDocument(app, config);
}

/**
 * Monta a Swagger UI em `/docs` somente fora de produção.
 *
 * Spec: /specs/backend-bootstrap (FR-04, R-5).
 *
 * @returns `true` quando o Swagger foi montado, `false` quando foi ignorado (produção).
 */
export function setupSwagger(app: INestApplication): boolean {
  if (process.env.NODE_ENV === 'production') {
    return false;
  }

  SwaggerModule.setup('docs', app, createSwaggerDocument(app));

  return true;
}
