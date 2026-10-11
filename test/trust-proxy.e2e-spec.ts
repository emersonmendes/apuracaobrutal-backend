import { Controller, Get, INestApplication, Req } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { configureApp } from '../src/config/configure-app';

@Controller('whoami')
class WhoAmIController {
  @Get()
  whoAmI(@Req() req: { ip: string }) {
    return { ip: req.ip };
  }
}

async function createApp(trustProxy: string | undefined): Promise<INestApplication> {
  if (trustProxy === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = trustProxy;

  const moduleFixture = await Test.createTestingModule({
    controllers: [WhoAmIController],
  }).compile();
  const app = moduleFixture.createNestApplication();
  configureApp(app);
  await app.listen(0);
  return app;
}

describe('TRUST_PROXY (e2e) — specs/backend-bootstrap AC-16', () => {
  const original = process.env.TRUST_PROXY;
  let app: INestApplication;

  afterEach(async () => {
    await app.close();
  });

  afterAll(() => {
    if (original === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = original;
  });

  it('com TRUST_PROXY=1, req.ip é o último salto do X-Forwarded-For e o forjado é ignorado', async () => {
    app = await createApp('1');

    const res = await request(app.getHttpServer())
      .get('/whoami')
      .set('X-Forwarded-For', '6.6.6.6, 203.0.113.7');

    expect(res.body).toEqual({ ip: '203.0.113.7' });
  });

  it.each([undefined, '0'])('com TRUST_PROXY=%p, o X-Forwarded-For é ignorado', async (value) => {
    app = await createApp(value);

    const res = await request(app.getHttpServer())
      .get('/whoami')
      .set('X-Forwarded-For', '203.0.113.7');

    expect(res.body.ip).not.toBe('203.0.113.7');
  });

  it('TRUST_PROXY inválido derruba a configuração (AC-17)', async () => {
    process.env.TRUST_PROXY = 'true';
    const moduleFixture = await Test.createTestingModule({
      controllers: [WhoAmIController],
    }).compile();
    app = moduleFixture.createNestApplication();

    expect(() => configureApp(app)).toThrow('TRUST_PROXY inválido');
  });
});
