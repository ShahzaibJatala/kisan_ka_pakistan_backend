import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMandiDto } from './dto/create-mandi.dto';
import { Role } from '@prisma/client';

@Injectable()
export class MandiService {
  constructor(private prisma: PrismaService) {}

  async create(createMandiDto: CreateMandiDto) {
    return this.prisma.mandi.create({
      data: createMandiDto,
    });
  }

  async findAll() {
    return this.prisma.mandi.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async findAllWithSadars() {
    return this.prisma.mandi.findMany({
      orderBy: { name: 'asc' },
      include: {
        users: {
          where: { role: Role.SADAR },
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            profileImage: true,
            city: true,
            address: true,
            status: true,
          }
        }
      }
    });
  }

  async getArtiasByMandi(mandiId: number) {
    const mandi = await this.prisma.mandi.findUnique({
      where: { id: mandiId }
    });

    if (!mandi) {
      throw new NotFoundException('Mandi not found');
    }

    const artias = await this.prisma.user.findMany({
      where: {
        mandiId,
        role: Role.ARTIA,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        profileImage: true,
        city: true,
        address: true,
      }
    });

    return {
      mandi,
      artias,
      count: artias.length,
    };
  }
}
