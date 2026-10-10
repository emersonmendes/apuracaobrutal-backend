import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './config/configure-app';
import { resolvePort } from './config/port';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);

  const port = resolvePort(process.env.PORT);
  // Bind em 0.0.0.0 para ser alcançável de fora do container.
  await app.listen(port, '0.0.0.0');
  console.log(`Application is running on: http://localhost:${port}`);
}

bootstrap();
