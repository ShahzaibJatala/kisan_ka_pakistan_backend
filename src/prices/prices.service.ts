import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePriceDto } from './dto/create-price.dto';
import { UpdatePriceDto } from './dto/update-price.dto';
import { PricesGateway } from './prices.gateway';

@Injectable()
export class PricesService {
  constructor(
    private prisma: PrismaService,
    private pricesGateway: PricesGateway,
  ) {}

  async create(createPriceDto: CreatePriceDto, userId: number) {
    const price = await this.prisma.price.create({
      data: { ...createPriceDto, userId },
    });
    this.pricesGateway.emitPriceUpdate(price);
    return price;
  }

  async update(id: number, updateData: UpdatePriceDto) {
    const price = await this.prisma.price.update({
      where: { id },
      data: updateData,
    });
    this.pricesGateway.emitPriceUpdate(price);
    return price;
  }

  async findAll(district?: string, city?: string) {
    const where: any = {};
    if (district) where.district = district;
    if (city) where.city = city;
    return this.prisma.price.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: { user: { select: { name: true, role: true } } },
    });
  }

  async findOne(id: number) {
    const price = await this.prisma.price.findUnique({ where: { id } });
    if (!price) throw new NotFoundException('Price not found');
    return price;
  }

  async findLatestPrices() {
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

    return Array.from(latestPricesMap.values());
  }
}
