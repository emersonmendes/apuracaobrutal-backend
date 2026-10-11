import { INestApplication, ValidationPipe } from '@nestjs/common';
import { buildCorsOptions, parseCorsOrigins } from './cors';
import { setupSwagger } from './swagger';
import { parseTrustProxy } from './trust-proxy';

/**
 * Aplica o pipeline HTTP compartilhado por `main.ts` e pelos testes e2e, para que os testes
 * exercitem a mesma configuração da produção. Spec: /specs/backend-bootstrap (FR-02).
 */
export function configureApp(app: INestApplication): void {
  // Valida todo DTO e rejeita campos desconhecidos (FR-02).
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  // Atrás do ALB, `req.ip` precisa ser o cliente real (limite por IP) sem aceitar XFF forjado (R-9).
  app.getHttpAdapter().getInstance().set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));

  // O navegador chama o backend direto (sem BFF); só a allow-list recebe CORS (FR-05, R-6).
  app.enableCors(buildCorsOptions(parseCorsOrigins(process.env.CORS_ORIGINS)));

  // Swagger em /docs somente fora de produção (R-5).
  setupSwagger(app);
}
