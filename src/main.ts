import * as dotenv from 'dotenv';
dotenv.config(); // This MUST happen before any other imports that use the DB

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, BadRequestException } from '@nestjs/common';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,       // auto-transform payloads to DTO types
      whitelist: true,       // strip unknown properties
      forbidNonWhitelisted: false,
      exceptionFactory: (errors) => {
        const messages = errors.flatMap((error) => {
          if (error.constraints) {
            return Object.values(error.constraints);
          }
          return [];
        });
        return new BadRequestException(messages[0] || 'Bad Request');
      },
    }),
  );

  app.enableCors({
    origin: ['http://localhost:3000', 'https://kisan-ka-pakistan.vercel.app'], // Your Next.js URL
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true, // Important if you use cookies later!
  });

  // Now process.env.PORT will actually have a value if defined in .env
  const port = process.env.PORT ?? 3001;

  await app.listen(port);
}
bootstrap();
