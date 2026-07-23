import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PesticidesAdminController } from './pesticides-admin.controller';
import { PesticidesController } from './pesticides.controller';
import { PesticidesService } from './pesticides.service';

@Module({ imports: [PrismaModule], controllers: [PesticidesController, PesticidesAdminController], providers: [PesticidesService], exports: [PesticidesService] })
export class PesticidesModule {}
