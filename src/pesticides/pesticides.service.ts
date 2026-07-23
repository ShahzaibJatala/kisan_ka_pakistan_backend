import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  ArtiaConnectionDto,
  CheckoutPesticideDto,
  ConnectionDecisionDto,
  CreatePesticideProductDto,
  CreateShopOfferDto,
  CreatePesticideShopDto,
  IssueArtiaReceiptDto,
  ReviewPesticideShopDto,
  RequestCatalogProductDto,
  ReviewCatalogProductDto,
  UpdatePesticideShopDto,
} from './dto/pesticides.dto';

const activeShop = { status: 'ACTIVE' };
const publicShopSelect = {
  id: true,
  slug: true,
  name: true,
  businessName: true,
  tagline: true,
  description: true,
  logoUrl: true,
  coverUrl: true,
  phone: true,
  whatsapp: true,
  address: true,
  city: true,
  district: true,
  ratingAverage: true,
  reviewCount: true,
  deliveryFee: true,
} as const;

@Injectable()
export class PesticidesService {
  constructor(private readonly prisma: PrismaService) {}

  async createShop(dto: CreatePesticideShopDto) {
    if (!dto.ownerId && (!dto.ownerName || !dto.ownerEmail || !dto.ownerPhone))
      throw new BadRequestException(
        'Provide an existing owner ID or the new owner name, email and phone.',
      );
    const existing = await this.prisma.pesticideShop.findUnique({
      where: { slug: dto.slug },
    });
    if (existing)
      throw new ConflictException('This shop URL is already in use.');
    let credentials: { email: string; temporaryPassword: string } | undefined;
    try {
      return await this.prisma.$transaction(async (tx) => {
      const licenseNumber = dto.licenseNumber?.trim();
      if (licenseNumber) {
        const existingLicence = await tx.pesticideShop.findFirst({
          where: { licenseNumber },
          select: { id: true },
        });
        if (existingLicence) {
          throw new ConflictException(
            'This pesticide licence number is already registered to another shop.',
          );
        }
      }
      let ownerId = dto.ownerId;
      if (!ownerId) {
        const email = dto.ownerEmail!.trim().toLowerCase();
        const phone = dto.ownerPhone!.trim();
        const existingOwner = await tx.user.findFirst({
          where: { OR: [{ email }, { phone }] },
          select: { email: true, phone: true },
        });
        if (existingOwner) {
          const field = existingOwner.email === email ? 'email address' : 'phone number';
          throw new ConflictException(
            `A user already exists with this owner ${field}. Use that user’s existing owner ID instead.`,
          );
        }
        const temporaryPassword = `Kkp!${randomBytes(12).toString('base64url')}`;
        const password = await bcrypt.hash(temporaryPassword, 12);
        const owner = await tx.user.create({
          data: {
            name: dto.ownerName!.trim(),
            email,
            phone,
            password,
            role: Role.PESTICIDE_SHOP_OWNER,
            status: UserStatus.VERIFIED,
            verifiedAt: new Date(),
          },
        });
        ownerId = owner.id;
        credentials = { email: owner.email!, temporaryPassword };
      } else {
        const owner = await tx.user.findUnique({ where: { id: ownerId } });
        if (!owner)
          throw new NotFoundException('Shop owner account not found.');
        await tx.user.update({
          where: { id: ownerId },
          data: {
            role: Role.PESTICIDE_SHOP_OWNER,
            status: UserStatus.VERIFIED,
          },
        });
      }
      const shop = await tx.pesticideShop.create({
        data: {
          ownerId,
          name: dto.name.trim(),
          slug: dto.slug,
          phone: dto.phone.trim(),
          businessName: dto.businessName?.trim(),
          email: dto.email?.trim().toLowerCase(),
          address: dto.address?.trim(),
          city: dto.city?.trim(),
          district: dto.district?.trim(),
          licenseNumber,
          // A Super Admin is the creator, so the storefront is ready immediately.
          status: 'ACTIVE',
          staff: { create: { userId: ownerId, role: 'OWNER' } },
        },
      });
      return {
        shop,
        ...(credentials ? { ownerCredentials: credentials } : {}),
      };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          'A shop owner phone number, email address, shop URL, or other unique value is already in use.',
        );
      }
      throw error;
    }
  }

  listShops(includeInactive = false) {
    return this.prisma.pesticideShop.findMany({
      where: includeInactive ? {} : activeShop,
      select: { ...publicShopSelect, status: true, createdAt: true },
      orderBy: [
        { ratingAverage: 'desc' },
        { reviewCount: 'desc' },
        { name: 'asc' },
      ],
    });
  }
  async myAccount(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        role: true,
        pesticideOwnedShops: {
          select: { id: true, name: true, slug: true, status: true, city: true },
          orderBy: { name: 'asc' },
        },
        pesticideShopMemberships: {
          select: {
            shop: { select: { id: true, name: true, slug: true, status: true, city: true } },
          },
        },
      },
    });
    if (!user) throw new NotFoundException('Account not found.');
    const stores = [
      ...user.pesticideOwnedShops,
      ...user.pesticideShopMemberships.map((membership) => membership.shop),
    ].filter((shop, index, values) => values.findIndex((item) => item.id === shop.id) === index);
    return { actor: { fullName: user.name, role: user.role }, stores };
  }
  async publicShop(slug: string) {
    const shop = await this.prisma.pesticideShop.findFirst({
      where: { slug, ...activeShop },
      select: {
        ...publicShopSelect,
        seoTitle: true,
        seoDescription: true,
        seoKeywords: true,
        googleBusinessUrl: true,
        offers: {
          where: { active: true, catalogProduct: { status: 'active' } },
          select: { id: true, price: true, stockQuantity: true, catalogProduct: { select: { id: true, genericName: true, brand: true, displayName: true, category: true, standardUnit: true, images: true } } },
          orderBy: { updatedAt: 'desc' },
        },
      },
    });
    if (!shop) throw new NotFoundException('Pesticide shop not found.');
    const { offers, ...profile } = shop;
    return { ...profile, products: offers.map(offer => ({ id: offer.id, catalogProductId: offer.catalogProduct.id, slug: String(offer.catalogProduct.id), name: offer.catalogProduct.displayName || offer.catalogProduct.genericName, brand: offer.catalogProduct.brand, category: offer.catalogProduct.category, packSize: offer.catalogProduct.standardUnit || 'Standard pack', price: offer.price, stockQuantity: offer.stockQuantity, imageUrl: Array.isArray(offer.catalogProduct.images) ? offer.catalogProduct.images.find((value): value is string => typeof value === 'string') : null })) };
  }
  async searchProducts(query: string) {
    const q = query.trim().slice(0, 80);
    if (q.length < 2) return [];
    const offers = await this.prisma.pesticideShopOffer.findMany({
      where: {
        active: true,
        shop: activeShop,
        catalogProduct: { status: 'active', OR: [{ genericName: { contains: q, mode: 'insensitive' } }, { brand: { contains: q, mode: 'insensitive' } }, { displayName: { contains: q, mode: 'insensitive' } }] },
      },
      select: {
        id: true,
        price: true,
        stockQuantity: true,
        catalogProduct: { select: { genericName: true, brand: true, displayName: true, standardUnit: true, images: true } },
        shop: { select: publicShopSelect },
      },
      orderBy: { price: 'asc' },
      take: 60,
    });
    return offers.map(offer => ({ id: offer.id, name: offer.catalogProduct.displayName || offer.catalogProduct.genericName, brand: offer.catalogProduct.brand, slug: String(offer.id), packSize: offer.catalogProduct.standardUnit || 'Standard pack', price: offer.price, stockQuantity: offer.stockQuantity, imageUrl: Array.isArray(offer.catalogProduct.images) ? offer.catalogProduct.images.find((value): value is string => typeof value === 'string') : null, shop: offer.shop }));
  }

  async updateShopStatus(shopId: number, status: string) {
    if (!['PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED'].includes(status))
      throw new BadRequestException('Invalid shop status.');
    return this.prisma.pesticideShop.update({
      where: { id: shopId },
      data: { status },
    });
  }
  async updateShopProfile(
    shopId: number,
    userId: number,
    dto: UpdatePesticideShopDto,
  ) {
    await this.assertShopAccess(shopId, userId);
    const actor = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    const data = this.clean(dto) as Record<string, unknown>;
    // Registered business identity is controlled by Super Admin only.
    if (actor?.role !== Role.SUPER_ADMIN) {
      for (const field of ['name', 'businessName', 'address', 'district', 'city', 'licenseNumber']) delete data[field];
    }
    return this.prisma.pesticideShop.update({
      where: { id: shopId },
      data,
    });
  }
  async adminShopDetails(shopId: number) {
    const shop = await this.prisma.pesticideShop.findUnique({ where: { id: shopId }, include: { owner: { select: { id: true, name: true, email: true, phone: true, status: true } }, staff: { include: { user: { select: { id: true, name: true, email: true, phone: true } } } }, _count: { select: { offers: true, orders: true, artiaConnections: true } } } });
    if (!shop) throw new NotFoundException('Pesticide shop not found.');
    return shop;
  }
  async adminUpdateShop(shopId: number, dto: UpdatePesticideShopDto) {
    await this.adminShopDetails(shopId);
    return this.prisma.pesticideShop.update({ where: { id: shopId }, data: this.clean(dto) });
  }
  async shopProfile(shopId: number, userId: number) {
    await this.assertShopAccess(shopId, userId);
    const shop = await this.prisma.pesticideShop.findUnique({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Pesticide shop not found.');
    return shop;
  }
  async searchCatalog(query: string) {
    const q = query.trim().slice(0, 100);
    if (q.length < 2) return [];
    return this.prisma.pesticideCatalogProduct.findMany({
      where: { status: 'active', OR: [{ genericName: { contains: q, mode: 'insensitive' } }, { brand: { contains: q, mode: 'insensitive' } }, { displayName: { contains: q, mode: 'insensitive' } }] },
      select: { id: true, genericName: true, brand: true, displayName: true, category: true, description: true, images: true, standardUnit: true }, orderBy: [{ genericName: 'asc' }, { brand: 'asc' }], take: 40,
    });
  }
  async addCatalogOffer(shopId: number, userId: number, dto: CreateShopOfferDto) {
    await this.assertShopAccess(shopId, userId);
    const catalog = await this.prisma.pesticideCatalogProduct.findFirst({ where: { id: dto.catalogProductId, status: 'active' }, select: { id: true } });
    if (!catalog) throw new NotFoundException('This approved catalog product is not available.');
    return this.prisma.pesticideShopOffer.upsert({ where: { shopId_catalogProductId: { shopId, catalogProductId: dto.catalogProductId } }, create: { shopId, catalogProductId: dto.catalogProductId, price: dto.price, stockQuantity: dto.stockQuantity }, update: { price: dto.price, stockQuantity: dto.stockQuantity, active: true }, include: { catalogProduct: true } });
  }
  async requestCatalogProduct(shopId: number, userId: number, dto: RequestCatalogProductDto) {
    await this.assertShopAccess(shopId, userId);
    const genericName = dto.genericName.trim(); const brand = dto.brand.trim();
    const existing = await this.prisma.pesticideCatalogProduct.findUnique({ where: { genericName_brand: { genericName, brand } }, select: { id: true, status: true } });
    if (existing?.status === 'active') throw new ConflictException('This catalog product already exists. Select it and add your price and stock.');
    const images = dto.photoUrl ? [dto.photoUrl.trim()] : undefined;
    return existing ? this.prisma.pesticideCatalogProduct.update({ where: { id: existing.id }, data: { displayName: dto.displayName?.trim(), category: dto.category?.trim(), description: dto.description?.trim(), images, standardUnit: dto.standardUnit?.trim(), status: 'pending_review', rejectionReason: null, submittedById: userId, requestedShopId: shopId } }) : this.prisma.pesticideCatalogProduct.create({ data: { genericName, brand, displayName: dto.displayName?.trim(), category: dto.category?.trim(), description: dto.description?.trim(), images, standardUnit: dto.standardUnit?.trim(), status: 'pending_review', submittedById: userId, requestedShopId: shopId } });
  }
  async pendingCatalogRequests() {
    const requests = await this.prisma.pesticideCatalogProduct.findMany({ where: { status: 'pending_review' }, include: { submittedBy: { select: { id: true, name: true, email: true, phone: true } }, requestedShop: { select: { id: true, name: true, slug: true } } }, orderBy: { createdAt: 'asc' } });
    const active = await this.prisma.pesticideCatalogProduct.findMany({ where: { status: 'active' }, select: { id: true, genericName: true, brand: true, displayName: true } });
    return requests.map(request => ({ ...request, likelyMatches: active.filter(product => product.genericName.toLowerCase().includes(request.genericName.toLowerCase()) || request.genericName.toLowerCase().includes(product.genericName.toLowerCase()) || product.brand.toLowerCase() === request.brand.toLowerCase()).slice(0, 5) }));
  }
  async reviewCatalogRequest(id: number, adminId: number, dto: ReviewCatalogProductDto) {
    const request = await this.prisma.pesticideCatalogProduct.findFirst({ where: { id, status: 'pending_review' } });
    if (!request) throw new NotFoundException('Pending product request not found.');
    if (dto.decision === 'REJECT') return this.prisma.pesticideCatalogProduct.update({ where: { id }, data: { status: 'rejected', rejectionReason: dto.reason?.trim() || 'Product request was not approved.', approvedById: adminId } });
    return this.prisma.$transaction(async tx => {
      const catalogId = dto.decision === 'SAME_PRODUCT' ? dto.matchedCatalogProductId : id;
      if (!catalogId) throw new BadRequestException('Select the matching catalog product.');
      if (dto.decision === 'SAME_PRODUCT') { const match = await tx.pesticideCatalogProduct.findFirst({ where: { id: catalogId, status: 'active' } }); if (!match) throw new NotFoundException('Matching active catalog product not found.'); await tx.pesticideCatalogProduct.update({ where: { id }, data: { status: 'rejected', rejectionReason: `Merged with catalog product ${catalogId}.`, approvedById: adminId } }); }
      else await tx.pesticideCatalogProduct.update({ where: { id }, data: { status: 'active', approvedById: adminId, rejectionReason: null } });
      if (request.requestedShopId && dto.price !== undefined && dto.stockQuantity !== undefined) await tx.pesticideShopOffer.upsert({ where: { shopId_catalogProductId: { shopId: request.requestedShopId, catalogProductId: catalogId } }, create: { shopId: request.requestedShopId, catalogProductId: catalogId, price: dto.price, stockQuantity: dto.stockQuantity }, update: { price: dto.price, stockQuantity: dto.stockQuantity, active: true } });
      return { message: dto.decision === 'SAME_PRODUCT' ? 'Request merged into the matching catalog product.' : 'Catalog product approved.', catalogProductId: catalogId };
    });
  }
  async createProduct(
    shopId: number,
    userId: number,
    dto: CreatePesticideProductDto,
  ) {
    await this.assertShopAccess(shopId, userId);
    return this.prisma.pesticideProduct.create({
      data: {
        shopId,
        name: dto.name.trim(),
        slug: dto.slug,
        sku: dto.sku.trim(),
        packSize: dto.packSize.trim(),
        price: dto.price,
        stockQuantity: dto.stockQuantity ?? 0,
        brand: dto.brand?.trim(),
        category: dto.category?.trim(),
        genericName: dto.genericName?.trim(),
        activeIngredient: dto.activeIngredient?.trim(),
        description: dto.description?.trim(),
        usageInstructions: dto.usageInstructions?.trim(),
        safetyInformation: dto.safetyInformation?.trim(),
        suitableCrops: dto.suitableCrops ?? [],
        targetPests: dto.targetPests ?? [],
        isCreditEligible: dto.isCreditEligible ?? false,
        isDeliveryEligible: dto.isDeliveryEligible ?? true,
      },
    });
  }
  async shopProducts(shopId: number, userId: number) {
    await this.assertShopAccess(shopId, userId);
    const offers = await this.prisma.pesticideShopOffer.findMany({ where: { shopId }, include: { catalogProduct: true }, orderBy: { updatedAt: 'desc' } });
    return offers.map(offer => ({ id: offer.id, catalogProductId: offer.catalogProductId, name: offer.catalogProduct.displayName || offer.catalogProduct.genericName, sku: `${offer.catalogProduct.genericName}-${offer.catalogProduct.brand}`, packSize: offer.catalogProduct.standardUnit || 'Standard pack', price: offer.price, stockQuantity: offer.stockQuantity, brand: offer.catalogProduct.brand, category: offer.catalogProduct.category, isActive: offer.active, updatedAt: offer.updatedAt }));
  }
  async shopOrders(shopId: number, userId: number) {
    await this.assertShopAccess(shopId, userId);
    return this.prisma.pesticideOrder.findMany({
      where: { shopId }, orderBy: { createdAt: 'desc' },
      select: { id: true, orderNumber: true, customerName: true, customerPhone: true, customerEmail: true, deliveryAddress: true, notes: true, subtotal: true, deliveryFee: true, total: true, status: true, createdAt: true, items: { select: { id: true, productId: true, productName: true, sku: true, quantity: true, unitPrice: true, lineTotal: true } } },
    });
  }
  async updateOrderStatus(shopId: number, orderId: number, userId: number, status: string) {
    await this.assertShopAccess(shopId, userId);
    const order = await this.prisma.pesticideOrder.findFirst({ where: { id: orderId, shopId }, select: { id: true } });
    if (!order) throw new NotFoundException('Order not found for this shop.');
    return this.prisma.pesticideOrder.update({ where: { id: orderId }, data: { status }, select: { id: true, orderNumber: true, status: true, updatedAt: true } });
  }
  async shopConnections(shopId: number, userId: number, role: Role) {
    if (role === Role.ARTIA) {
      const allowed = await this.prisma.pesticideShopArtiaConnection.findFirst({ where: { shopId, artiaId: userId }, select: { id: true } });
      if (!allowed) throw new ForbiddenException('This shop connection is outside your account scope.');
    } else await this.assertShopAccess(shopId, userId);
    return this.prisma.pesticideShopArtiaConnection.findMany({
      where: role === Role.ARTIA ? { shopId, artiaId: userId } : { shopId }, orderBy: { updatedAt: 'desc' },
      select: { id: true, status: true, reason: true, creditLimit: true, settlementTerms: true, shopAcceptedAt: true, artiaAcceptedAt: true, createdAt: true, updatedAt: true, artia: { select: { id: true, name: true, phone: true, email: true, status: true, mandi: { select: { id: true, name: true, city: true } }, artiaProfile: { select: { shopName: true, address: true } } } } },
    });
  }

  async requestArtiaConnection(
    shopId: number,
    userId: number,
    userRole: Role,
    dto: ArtiaConnectionDto,
  ) {
    const artiaId = userRole === Role.ARTIA ? userId : dto.artiaId;
    if (!artiaId) throw new BadRequestException('Select the Artia account.');
    if (userRole !== Role.ARTIA) await this.assertShopAccess(shopId, userId);
    const artia = await this.prisma.user.findFirst({
      where: { id: artiaId, role: Role.ARTIA, status: UserStatus.VERIFIED },
    });
    if (!artia)
      throw new NotFoundException('Verified Artia account not found.');
    const now = new Date();
    const ownAcceptance =
      userRole === Role.ARTIA
        ? { artiaAcceptedAt: now }
        : { shopAcceptedAt: now };
    return this.prisma.pesticideShopArtiaConnection.upsert({
      where: { shopId_artiaId: { shopId, artiaId } },
      create: {
        shopId,
        artiaId,
        requestedById: userId,
        creditLimit: dto.creditLimit,
        settlementTerms: dto.settlementTerms?.trim(),
        ...ownAcceptance,
      },
      update: {
        status: 'PENDING',
        reason: null,
        creditLimit: dto.creditLimit,
        settlementTerms: dto.settlementTerms?.trim(),
        ...ownAcceptance,
      },
    });
  }
  async decideArtiaConnection(
    shopId: number,
    connectionId: number,
    userId: number,
    userRole: Role,
    dto: ConnectionDecisionDto,
  ) {
    const connection = await this.prisma.pesticideShopArtiaConnection.findFirst(
      { where: { id: connectionId, shopId } },
    );
    if (!connection) throw new NotFoundException('Connection not found.');
    const artiaSide = userRole === Role.ARTIA;
    if (artiaSide && connection.artiaId !== userId)
      throw new ForbiddenException(
        'This Artia connection is outside your account scope.',
      );
    if (!artiaSide) await this.assertShopAccess(shopId, userId);
    if (dto.decision === 'REJECT' || dto.decision === 'SUSPEND')
      return this.prisma.pesticideShopArtiaConnection.update({
        where: { id: connectionId },
        data: {
          status: dto.decision === 'SUSPEND' ? 'SUSPENDED' : 'REJECTED',
          reason: dto.reason?.trim() || null,
        },
      });
    const data = artiaSide
      ? { artiaAcceptedAt: new Date() }
      : { shopAcceptedAt: new Date() };
    const status = (
      artiaSide ? connection.shopAcceptedAt : connection.artiaAcceptedAt
    )
      ? 'APPROVED'
      : 'PENDING';
    return this.prisma.pesticideShopArtiaConnection.update({
      where: { id: connectionId },
      data: { ...data, status },
    });
  }

  async checkout(dto: CheckoutPesticideDto, customerId?: number) {
    const uniqueItems = new Map<number, number>();
    for (const item of dto.items)
      uniqueItems.set(
        item.productId,
        (uniqueItems.get(item.productId) ?? 0) + item.quantity,
      );
    if (uniqueItems.size !== dto.items.length)
      throw new BadRequestException(
        'Each product can only appear once in an order.',
      );
    return this.prisma.$transaction(async (tx) => {
      const shop = await tx.pesticideShop.findFirst({
        where: { id: dto.shopId, ...activeShop },
      });
      if (!shop)
        throw new NotFoundException('This shop is not available for checkout.');
      const products = await tx.pesticideShopOffer.findMany({
        where: {
          id: { in: [...uniqueItems.keys()] },
          shopId: dto.shopId,
          active: true,
        },
        include: { catalogProduct: true },
      });
      if (products.length !== uniqueItems.size)
        throw new BadRequestException(
          'One or more requested products are unavailable.',
        );
      let subtotal = 0;
      for (const product of products) {
        const quantity = uniqueItems.get(product.id)!;
        const changed = await tx.pesticideShopOffer.updateMany({
          where: { id: product.id, stockQuantity: { gte: quantity } },
          data: { stockQuantity: { decrement: quantity } },
        });
        if (changed.count !== 1)
          throw new ConflictException(
            `Insufficient stock for ${product.catalogProduct.displayName || product.catalogProduct.genericName}.`,
          );
        subtotal += product.price * quantity;
      }
      const orderNumber = `PS-${Date.now()}-${randomBytes(3).toString('hex').toUpperCase()}`;
      const order = await tx.pesticideOrder.create({
        data: {
          orderNumber,
          shopId: dto.shopId,
          customerId,
          customerName: dto.customerName.trim(),
          customerPhone: dto.customerPhone.trim(),
          customerEmail: dto.customerEmail?.trim().toLowerCase(),
          deliveryAddress: dto.deliveryAddress.trim(),
          notes: dto.notes?.trim(),
          subtotal,
          deliveryFee: shop.deliveryFee,
          total: subtotal + shop.deliveryFee,
          items: {
            create: products.map((product) => ({
              shopOfferId: product.id,
              productName: product.catalogProduct.displayName || product.catalogProduct.genericName,
              sku: `${product.catalogProduct.genericName}-${product.catalogProduct.brand}`,
              quantity: uniqueItems.get(product.id)!,
              unitPrice: product.price,
              lineTotal: product.price * uniqueItems.get(product.id)!,
            })),
          },
        },
      });
      await tx.notification.create({
        data: {
          userId: shop.ownerId,
          type: 'PESTICIDE_ORDER',
          title_en: 'New pesticide shop order',
          title_ur: 'نیا پیسٹی سائیڈ شاپ آرڈر',
          body_en: `${order.customerName} ordered ${dto.items.length} item(s) for ${order.deliveryAddress}.`,
          body_ur: 'آپ کی پیسٹی سائیڈ شاپ کے لیے نیا آرڈر موصول ہوا ہے۔',
          metadata: JSON.stringify({ shopId: shop.id, orderId: order.id }),
        },
      });
      return order;
    });
  }

  async reviewShop(
    shopId: number,
    userId: number,
    dto: ReviewPesticideShopDto,
  ) {
    if (dto.rating > 5)
      throw new BadRequestException('Rating must be between 1 and 5.');
    await this.ensureActiveShop(shopId);
    const review = await this.prisma.pesticideShopReview.upsert({
      where: { shopId_userId: { shopId, userId } },
      create: { shopId, userId, rating: dto.rating, body: dto.body?.trim() },
      update: { rating: dto.rating, body: dto.body?.trim() },
    });
    const result = await this.prisma.pesticideShopReview.aggregate({
      where: { shopId },
      _avg: { rating: true },
      _count: { rating: true },
    });
    await this.prisma.pesticideShop.update({
      where: { id: shopId },
      data: {
        ratingAverage: result._avg.rating ?? 0,
        reviewCount: result._count.rating,
      },
    });
    return review;
  }

  async issueArtiaReceipt(
    shopId: number,
    userId: number,
    dto: IssueArtiaReceiptDto,
  ) {
    await this.assertShopAccess(shopId, userId);
    const connection = await this.prisma.pesticideShopArtiaConnection.findFirst(
      { where: { shopId, artiaId: dto.artiaId, status: 'APPROVED' } },
    );
    if (!connection)
      throw new BadRequestException(
        'An approved shop–Artia connection is required.',
      );
    const farmer = await this.prisma.user.findFirst({
      where: {
        id: dto.farmerId,
        role: Role.FARMER,
        status: UserStatus.VERIFIED,
      },
    });
    if (!farmer) throw new NotFoundException('Verified farmer not found.');
    const products = await this.prisma.pesticideProduct.findMany({
      where: {
        id: { in: dto.items.map((item) => item.productId) },
        shopId,
        isActive: true,
      },
    });
    if (products.length !== dto.items.length)
      throw new BadRequestException(
        'Receipt contains a product not sold by this shop.',
      );
    const quantities = new Map(
      dto.items.map((item) => [item.productId, item.quantity]),
    );
    const reference = `AR-${Date.now()}-${randomBytes(3).toString('hex').toUpperCase()}`;
    return this.prisma.$transaction(async (tx) =>
      tx.pesticideArtiaReceipt.create({
        data: {
          reference,
          shopId,
          artiaId: dto.artiaId,
          farmerId: dto.farmerId,
          issuedById: userId,
          items: {
            create: products.map((product) => ({
              productId: product.id,
              productName: product.name,
              quantity: quantities.get(product.id)!,
              unitPrice: product.price,
            })),
          },
        },
      }),
    );
  }
  async confirmArtiaReceipt(reference: string, artiaId: number) {
    const receipt = await this.prisma.pesticideArtiaReceipt.findFirst({
      where: { reference, artiaId },
    });
    if (!receipt)
      throw new NotFoundException('Receipt not found for this Artia.');
    if (receipt.status !== 'ISSUED')
      throw new BadRequestException('This receipt cannot be confirmed.');
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.pesticideArtiaReceipt.update({
        where: { id: receipt.id },
        data: { status: 'CONFIRMED', confirmedAt: new Date() },
      });
      await tx.notification.create({
        data: {
          userId: receipt.farmerId,
          type: 'PESTICIDE_RECEIPT_CONFIRMED',
          title_en: 'Pesticide delivery confirmed',
          title_ur: 'پیسٹی سائیڈ ڈیلیوری کی تصدیق',
          body_en: `Your Artia confirmed pesticide receipt ${reference}.`,
          body_ur: `آپ کے آڑھتی نے پیسٹی سائیڈ رسید ${reference} کی تصدیق کی ہے۔`,
          metadata: JSON.stringify({ receiptId: receipt.id }),
        },
      });
      return result;
    });
  }

  private async assertShopAccess(shopId: number, userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (user?.role === Role.SUPER_ADMIN) return;
    const membership = await this.prisma.pesticideShop.findFirst({
      where: {
        id: shopId,
        OR: [{ ownerId: userId }, { staff: { some: { userId } } }],
      },
      select: { id: true },
    });
    if (!membership)
      throw new ForbiddenException(
        'This pesticide shop is outside your account scope.',
      );
  }
  private async ensureActiveShop(shopId: number) {
    const shop = await this.prisma.pesticideShop.findFirst({
      where: { id: shopId, ...activeShop },
      select: { id: true },
    });
    if (!shop) throw new NotFoundException('Pesticide shop not found.');
  }
  private clean<T extends object>(value: T) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [
          key,
          typeof item === 'string' ? item.trim() : item,
        ]),
    );
  }
}
