import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { FarmerService } from './farmer.service';
import { FarmerController } from './farmer.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';
import { JwtModule } from '@nestjs/jwt';
import { LedgerGateway } from './ledger.gateway';
import { BypassModule } from '../bypass/bypass.module';

@Module({
  imports: [
    PrismaModule,
    MailModule,
    BypassModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'secretKey',
      signOptions: { expiresIn: '7d' },
    }),
    BullModule.registerQueue(
      { name: 'otp-queue' },
      { name: 'price-aggregation' },
    ),
  ],
  providers: [FarmerService, LedgerGateway],
  controllers: [FarmerController],
  exports: [FarmerService],
})
export class FarmerModule {}
