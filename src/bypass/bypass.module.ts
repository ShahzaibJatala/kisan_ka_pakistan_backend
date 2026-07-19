import { Module } from '@nestjs/common';
import { BypassService } from './bypass.service';
import { BypassController } from './bypass.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [BypassController],
  providers: [BypassService],
  exports: [BypassService],
})
export class BypassModule {}
