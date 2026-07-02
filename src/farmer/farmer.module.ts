import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { FarmerService } from './farmer.service';
import { FarmerController } from './farmer.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,
    BullModule.registerQueue(
      { name: 'otp-queue' },
      { name: 'price-aggregation' },
    ),
  ],
  providers: [FarmerService],
  controllers: [FarmerController],
  exports: [FarmerService],
})
export class FarmerModule {}
