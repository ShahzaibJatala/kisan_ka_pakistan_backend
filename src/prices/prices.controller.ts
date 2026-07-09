import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Req,
  UseGuards,
  Query,
} from '@nestjs/common';
import { PricesService } from './prices.service';
import { CreatePriceDto } from './dto/create-price.dto';
import { UpdatePriceDto } from './dto/update-price.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';
import { Role } from '@prisma/client';

@Controller('prices')
export class PricesController {
  constructor(private readonly pricesService: PricesService) {}

  // GUEST (public)
  @Get()
  findAll(@Query('district') district?: string, @Query('city') city?: string) {
    return this.pricesService.findAll(district, city);
  }

  // GUEST (public)
  @Get('latest')
  findLatestPrices() {
    return this.pricesService.findLatestPrices();
  }

  // GUEST (public)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.pricesService.findOne(+id);
  }

  // Guarded
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SADAR, Role.ARTIA, Role.FARMER)
  @Post()
  create(@Body() createPriceDto: CreatePriceDto, @Req() req: any) {
    return this.pricesService.create(createPriceDto, req.user.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SADAR, Role.ARTIA, Role.FARMER)
  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() updatePriceDto: UpdatePriceDto,
  ) {
    return this.pricesService.update(+id, updatePriceDto);
  }
}
