import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { PricesModule } from './prices/prices.module';
import { PostsModule } from './posts/posts.module';
import { PrismaModule } from './prisma/prisma.module';
import { MailModule } from './mail/mail.module';
import { FarmerModule } from './farmer/farmer.module';
import { MandiModule } from './mandi/mandi.module';
import { RedisModule } from './redis/redis.module';
import { BypassModule } from './bypass/bypass.module';
import { AdminModule } from './admin/admin.module';
import { PesticidesModule } from './pesticides/pesticides.module';
import { RateLimiterGuard } from './auth/guards/rate-limiter.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_CLOUD_HOST || 'localhost',
        port: parseInt(process.env.REDIS_CLOUD_PORT || '13671', 10),
        username: 'default',
        password: process.env.REDIS_CLOUD_PASSWORD,
        // Disable TLS if connecting locally or if REDIS_CLOUD_HOST is not set
        // tls: process.env.REDIS_CLOUD_HOST ? {} : undefined,
      },
    }),
    UsersModule,
    AuthModule,
    PricesModule,
    PostsModule,
    PrismaModule,
    MailModule,
    FarmerModule,
    MandiModule,
    RedisModule,
    BypassModule,
    AdminModule,
    PesticidesModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Global rate limiter: 100 requests/min per user (authenticated) or IP (unauthenticated)
    // Registered via APP_GUARD so NestJS DI can inject RedisService correctly
    {
      provide: APP_GUARD,
      useClass: RateLimiterGuard,
    },
  ],
})
export class AppModule {}
