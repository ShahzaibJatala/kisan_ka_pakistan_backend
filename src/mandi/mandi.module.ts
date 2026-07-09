import { Module } from '@nestjs/common';
import { MandiService } from './mandi.service';
import { MandiController } from './mandi.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [MandiController],
  providers: [MandiService],
  exports: [MandiService],
})
export class MandiModule {}
