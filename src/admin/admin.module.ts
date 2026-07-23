import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { BypassModule } from '../bypass/bypass.module';

@Module({ imports: [PrismaModule, BypassModule], controllers: [AdminController], providers: [AdminService] })
export class AdminModule {}
