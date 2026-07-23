import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';
import { ArtiaConnectionDto, CheckoutPesticideDto, ConnectionDecisionDto, CreatePesticideProductDto, CreateShopOfferDto, IssueArtiaReceiptDto, RequestCatalogProductDto, ReviewPesticideShopDto, UpdatePesticideOrderStatusDto, UpdatePesticideShopDto } from './dto/pesticides.dto';
import { PesticidesService } from './pesticides.service';

@Controller('pesticides')
export class PesticidesController {
  constructor(private readonly pesticides: PesticidesService) {}

  @Get('shops') shops() { return this.pesticides.listShops(); }
  @Get('products/search') search(@Query('q') q = '') { return this.pesticides.searchProducts(q); }
  @Get('catalog/search') catalog(@Query('q') q = '') { return this.pesticides.searchCatalog(q); }
  @Get('shops/:slug') shop(@Param('slug') slug: string) { return this.pesticides.publicShop(slug); }

  @UseGuards(JwtAuthGuard)
  @Get('me') me(@Req() req: any) { return this.pesticides.myAccount(req.user.id); }

  @Post('guest-checkout') guestCheckout(@Body() dto: CheckoutPesticideDto) { return this.pesticides.checkout(dto); }
  @UseGuards(JwtAuthGuard) @Post('checkout') checkout(@Body() dto: CheckoutPesticideDto, @Req() req: any) { return this.pesticides.checkout(dto, req.user.id); }

  @UseGuards(JwtAuthGuard, RolesGuard) @Roles(Role.FARMER, Role.ARTIA, Role.SADAR, Role.PESTICIDE_SHOP_OWNER)
  @Post('shops/:shopId/reviews') review(@Param('shopId', ParseIntPipe) shopId: number, @Body() dto: ReviewPesticideShopDto, @Req() req: any) { return this.pesticides.reviewShop(shopId, req.user.id, dto); }

  @UseGuards(JwtAuthGuard, RolesGuard) @Roles(Role.ARTIA)
  @Post('shops/:shopId/artia-connections') requestArtiaConnection(@Param('shopId', ParseIntPipe) shopId: number, @Body() dto: ArtiaConnectionDto, @Req() req: any) { return this.pesticides.requestArtiaConnection(shopId, req.user.id, req.user.role, dto); }
  @UseGuards(JwtAuthGuard, RolesGuard) @Roles(Role.ARTIA)
  @Post('artia-receipts/:reference/confirm') confirmReceipt(@Param('reference') reference: string, @Req() req: any) { return this.pesticides.confirmArtiaReceipt(reference, req.user.id); }

  @UseGuards(JwtAuthGuard, RolesGuard) @Roles(Role.PESTICIDE_SHOP_OWNER, Role.SUPER_ADMIN)
  @Get('shops/:shopId/manage/products') products(@Param('shopId', ParseIntPipe) shopId: number, @Req() req: any) { return this.pesticides.shopProducts(shopId, req.user.id); }
  @UseGuards(JwtAuthGuard, RolesGuard) @Roles(Role.PESTICIDE_SHOP_OWNER, Role.SUPER_ADMIN)
  @Get('shops/:shopId/manage/orders') orders(@Param('shopId', ParseIntPipe) shopId: number, @Req() req: any) { return this.pesticides.shopOrders(shopId, req.user.id); }
  @UseGuards(JwtAuthGuard, RolesGuard) @Roles(Role.PESTICIDE_SHOP_OWNER, Role.SUPER_ADMIN)
  @Patch('shops/:shopId/manage/orders/:orderId/status') orderStatus(@Param('shopId', ParseIntPipe) shopId: number, @Param('orderId', ParseIntPipe) orderId: number, @Body() dto: UpdatePesticideOrderStatusDto, @Req() req: any) { return this.pesticides.updateOrderStatus(shopId, orderId, req.user.id, dto.status); }
  @UseGuards(JwtAuthGuard, RolesGuard) @Roles(Role.PESTICIDE_SHOP_OWNER, Role.SUPER_ADMIN, Role.ARTIA)
  @Get('shops/:shopId/connections') connections(@Param('shopId', ParseIntPipe) shopId: number, @Req() req: any) { return this.pesticides.shopConnections(shopId, req.user.id, req.user.role); }
  @UseGuards(JwtAuthGuard, RolesGuard) @Roles(Role.PESTICIDE_SHOP_OWNER, Role.SUPER_ADMIN)
  @Get('shops/:shopId/manage/profile') managedProfile(@Param('shopId', ParseIntPipe) shopId: number, @Req() req: any) { return this.pesticides.shopProfile(shopId, req.user.id); }
  @UseGuards(JwtAuthGuard, RolesGuard) @Roles(Role.PESTICIDE_SHOP_OWNER, Role.SUPER_ADMIN)
  @Patch('shops/:shopId/profile') profile(@Param('shopId', ParseIntPipe) shopId: number, @Body() dto: UpdatePesticideShopDto, @Req() req: any) { return this.pesticides.updateShopProfile(shopId, req.user.id, dto); }
  @UseGuards(JwtAuthGuard, RolesGuard) @Roles(Role.PESTICIDE_SHOP_OWNER, Role.SUPER_ADMIN)
  @Post('shops/:shopId/products') product(@Param('shopId', ParseIntPipe) shopId: number, @Body() dto: CreatePesticideProductDto, @Req() req: any) { return this.pesticides.createProduct(shopId, req.user.id, dto); }
  @UseGuards(JwtAuthGuard, RolesGuard) @Roles(Role.PESTICIDE_SHOP_OWNER, Role.SUPER_ADMIN)
  @Post('shops/:shopId/offers') offer(@Param('shopId', ParseIntPipe) shopId: number, @Body() dto: CreateShopOfferDto, @Req() req: any) { return this.pesticides.addCatalogOffer(shopId, req.user.id, dto); }
  @UseGuards(JwtAuthGuard, RolesGuard) @Roles(Role.PESTICIDE_SHOP_OWNER, Role.SUPER_ADMIN)
  @Post('shops/:shopId/catalog-requests') catalogRequest(@Param('shopId', ParseIntPipe) shopId: number, @Body() dto: RequestCatalogProductDto, @Req() req: any) { return this.pesticides.requestCatalogProduct(shopId, req.user.id, dto); }
  @UseGuards(JwtAuthGuard, RolesGuard) @Roles(Role.PESTICIDE_SHOP_OWNER, Role.SUPER_ADMIN)
  @Post('shops/:shopId/connections') requestConnection(@Param('shopId', ParseIntPipe) shopId: number, @Body() dto: ArtiaConnectionDto, @Req() req: any) { return this.pesticides.requestArtiaConnection(shopId, req.user.id, req.user.role, dto); }
  @UseGuards(JwtAuthGuard, RolesGuard) @Roles(Role.PESTICIDE_SHOP_OWNER, Role.SUPER_ADMIN, Role.ARTIA)
  @Patch('shops/:shopId/connections/:connectionId') decideConnection(@Param('shopId', ParseIntPipe) shopId: number, @Param('connectionId', ParseIntPipe) connectionId: number, @Body() dto: ConnectionDecisionDto, @Req() req: any) { return this.pesticides.decideArtiaConnection(shopId, connectionId, req.user.id, req.user.role, dto); }
  @UseGuards(JwtAuthGuard, RolesGuard) @Roles(Role.PESTICIDE_SHOP_OWNER, Role.SUPER_ADMIN)
  @Post('shops/:shopId/artia-receipts') issueReceipt(@Param('shopId', ParseIntPipe) shopId: number, @Body() dto: IssueArtiaReceiptDto, @Req() req: any) { return this.pesticides.issueArtiaReceipt(shopId, req.user.id, dto); }
}
