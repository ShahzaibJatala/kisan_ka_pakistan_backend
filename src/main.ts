import * as dotenv from 'dotenv';
dotenv.config(); // This MUST happen before any other imports that use the DB

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());

  app.enableCors({
    origin: 'http://localhost:3000', // Your Next.js URL
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true, // Important if you use cookies later!
  });

  // Now process.env.PORT will actually have a value if defined in .env
  const port = process.env.PORT ?? 3001;

  await app.listen(port);
}
bootstrap();
