import { Controller, Get, Post, Body, Param, UseGuards, ParseIntPipe } from '@nestjs/common';
import { MandiService } from './mandi.service';
import { CreateMandiDto } from './dto/create-mandi.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';
import { Role } from '@prisma/client';

@Controller('mandis')
export class MandiController {
  constructor(private readonly mandiService: MandiService) {}

  @Post()
  create(@Body() createMandiDto: CreateMandiDto) {
    return this.mandiService.create(createMandiDto);
  }

  @Get()
  findAll() {
    return this.mandiService.findAll();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  @Get('with-sadars')
  findAllWithSadars() {
    return this.mandiService.findAllWithSadars();
  }

  @Get(':id/artias')
  getArtiasByMandi(@Param('id', ParseIntPipe) id: number) {
    return this.mandiService.getArtiasByMandi(id);
  }
}
