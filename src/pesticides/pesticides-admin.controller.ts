import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';
import { CreatePesticideShopDto, ReviewCatalogProductDto, UpdatePesticideShopDto } from './dto/pesticides.dto';
import { Req } from '@nestjs/common';
import { PesticidesService } from './pesticides.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
@Controller('admin/pesticide-shops')
export class PesticidesAdminController {
  constructor(private readonly pesticides: PesticidesService) {}
  @Get() shops() { return this.pesticides.listShops(true); }
  @Get(':shopId') details(@Param('shopId', ParseIntPipe) shopId: number) { return this.pesticides.adminShopDetails(shopId); }
  @Post() create(@Body() dto: CreatePesticideShopDto) { return this.pesticides.createShop(dto); }
  @Patch(':shopId') update(@Param('shopId', ParseIntPipe) shopId: number, @Body() dto: UpdatePesticideShopDto) { return this.pesticides.adminUpdateShop(shopId, dto); }
  @Patch(':shopId/status/:status') status(@Param('shopId', ParseIntPipe) shopId: number, @Param('status') status: string) { return this.pesticides.updateShopStatus(shopId, status); }
  @Get('catalog/pending') pendingCatalog() { return this.pesticides.pendingCatalogRequests(); }
  @Patch('catalog/:id/review') reviewCatalog(@Param('id', ParseIntPipe) id: number, @Body() dto: ReviewCatalogProductDto, @Req() req: any) { return this.pesticides.reviewCatalogRequest(id, req.user.id, dto); }
}
