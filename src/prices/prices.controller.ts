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
import { PriceRateLimiterGuard } from '../auth/guards/price-rate-limiter.guard';

@Controller('prices')
export class PricesController {
  constructor(private readonly pricesService: PricesService) {}

  // GUEST (public)
  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('district') district?: string,
    @Query('city') city?: string,
    @Query('product') product?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return this.pricesService.findAll(pageNum, limitNum, district, city, product);
  }

  // GUEST (public)
  @Get('latest')
  findLatestPrices() {
    return this.pricesService.findLatestPrices();
  }

  @Get('products/listings')
  findProductListings(@Query('district') district?: string, @Query('city') city?: string, @Query('product') product?: string) {
    return this.pricesService.findProductListings(district, city, product);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FARMER)
  @Post('products/listings')
  createProductListing(@Body() dto: { productName: string; quantity: number; unit: string; askingPrice: number; description?: string; phone: string; district?: string; city?: string }, @Req() req: any) {
    return this.pricesService.createProductListing(dto, req.user.id);
  }

  // GUEST (public)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.pricesService.findOne(+id);
  }

  // Guarded: authenticated + role + price rate limit (5 posts/user/hour)
  @UseGuards(JwtAuthGuard, RolesGuard, PriceRateLimiterGuard)
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
