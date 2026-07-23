import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePriceDto } from './dto/create-price.dto';
import { UpdatePriceDto } from './dto/update-price.dto';
import { PricesGateway } from './prices.gateway';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class PricesService {
  constructor(
    private prisma: PrismaService,
    private pricesGateway: PricesGateway,
    private redisService: RedisService,
  ) {}

  async create(createPriceDto: CreatePriceDto, userId: number) {
    const price = await this.prisma.price.create({
      data: { ...createPriceDto, userId },
    });
    this.pricesGateway.emitPriceUpdate(price);

    // Invalidate caches
    await this.redisService.del('prices:latest');
    await this.redisService.del('prices:crops:latest');
    await this.redisService.del('home:feed');

    return price;
  }

  async update(id: number, updateData: UpdatePriceDto) {
    const price = await this.prisma.price.update({
      where: { id },
      data: updateData,
    });
    this.pricesGateway.emitPriceUpdate(price);

    // Invalidate caches
    await this.redisService.del('prices:latest');
    await this.redisService.del('prices:crops:latest');
    await this.redisService.del('home:feed');

    return price;
  }

  async findAll(page: number = 1, limit: number = 10, district?: string, city?: string, product?: string) {
    const isFirstPageWithoutFilters = page === 1 && limit === 10 && !district && !city && !product;
    const cacheKey = 'prices:latest';

    if (isFirstPageWithoutFilters) {
      const cached = await this.redisService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    }

    const skip = (page - 1) * limit;
    const where: any = {};
    if (district) where.district = district;
    if (city) where.city = city;
    if (product) {
      where.OR = [
        { name_en: { contains: product, mode: 'insensitive' } },
        { name_ur: { contains: product, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.price.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        include: { user: { select: { name: true, role: true } } },
      }),
      this.prisma.price.count({ where }),
    ]);

    const result = {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };

    if (isFirstPageWithoutFilters) {
      // Cache the first page of prices for 5 minutes
      await this.redisService.set(cacheKey, JSON.stringify(result), 300);
    }

    return result;
  }

  async findOne(id: number) {
    const price = await this.prisma.price.findUnique({ where: { id } });
    if (!price) throw new NotFoundException('Price not found');
    return price;
  }

  async findLatestPrices() {
    const cacheKey = 'prices:crops:latest';
    const cached = await this.redisService.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const allPrices = await this.prisma.price.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, role: true } }
      }
    });

    const latestPricesMap = new Map<string, any>();
    for (const price of allPrices) {
      const key = price.cropId 
        ? `id_${price.cropId}` 
        : (price.name_en || price.name_ur || 'unknown').toLowerCase().trim();
      
      if (!latestPricesMap.has(key)) {
        latestPricesMap.set(key, {
          cropId: price.cropId,
          cropName: price.name_en || price.name_ur || 'Unknown',
          latestPrice: price
        });
      }
    }

    const result = Array.from(latestPricesMap.values());

    // Cache latest crop prices for 10 minutes
    await this.redisService.set(cacheKey, JSON.stringify(result), 600);

    return result;
  }

  async createProductListing(dto: { productName: string; quantity: number; unit: string; askingPrice: number; description?: string; phone: string; district?: string; city?: string }, farmerId: number) {
    return this.prisma.productListing.create({ data: { ...dto, farmerId } });
  }

  async findProductListings(district?: string, city?: string, product?: string) {
    const where: any = { ...(district ? { district } : {}), ...(city ? { city } : {}) };
    if (product) where.productName = { contains: product, mode: 'insensitive' };
    return this.prisma.productListing.findMany({ where, orderBy: { createdAt: 'desc' }, include: { farmer: { select: { name: true } } } });
  }
}
