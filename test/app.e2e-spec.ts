import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/config/configure-app';

describe('Health + CORS (e2e) — specs/backend-bootstrap', () => {
  let app: INestApplication;
  const originalCors = process.env.CORS_ORIGINS;

  beforeAll(async () => {
    // Usa a origem padrão (http://localhost:3100).
    delete process.env.CORS_ORIGINS;

    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    // Já escutando (porta efêmera): o supertest não reabre o servidor a cada requisição.
    await app.listen(0);
  });

  afterAll(async () => {
    process.env.CORS_ORIGINS = originalCors;
    await app.close();
  });

  it('GET /ping → 200 com corpo "pong" (AC-01)', () => {
    return request(app.getHttpServer()).get('/ping').expect(200).expect('pong');
  });

  it('GET /ping → Content-Type contém text/plain (AC-02)', () => {
    return request(app.getHttpServer())
      .get('/ping')
      .expect(200)
      .expect('Content-Type', /text\/plain/);
  });

  it('POST /ping → 404 (AC-03)', () => {
    return request(app.getHttpServer()).post('/ping').expect(404);
  });

  it('GET /unknown-path → 404 (AC-04)', () => {
    return request(app.getHttpServer()).get('/unknown-path').expect(404);
  });

  it('origem permitida recebe Access-Control-Allow-Origin (AC-05)', () => {
    return request(app.getHttpServer())
      .get('/ping')
      .set('Origin', 'http://localhost:3100')
      .expect(200)
      .expect('Access-Control-Allow-Origin', 'http://localhost:3100');
  });

  it('origem não permitida não recebe Access-Control-Allow-Origin (AC-06)', async () => {
    const res = await request(app.getHttpServer())
      .get('/ping')
      .set('Origin', 'https://outro-site.example')
      .expect(200);

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('preflight de origem permitida é respondido pelo CORS', () => {
    return request(app.getHttpServer())
      .options('/ping')
      .set('Origin', 'http://localhost:3100')
      .set('Access-Control-Request-Method', 'GET')
      .expect(204)
      .expect('Access-Control-Allow-Origin', 'http://localhost:3100');
  });

  it('preflight de origem não permitida não recebe headers de CORS', async () => {
    const res = await request(app.getHttpServer())
      .options('/ping')
      .set('Origin', 'https://outro-site.example')
      .set('Access-Control-Request-Method', 'GET');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('requisições concorrentes ao /ping retornam 200', async () => {
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => request(app.getHttpServer()).get('/ping')),
    );

    expect(responses.every((res) => res.status === 200 && res.text === 'pong')).toBe(true);
  });
});
