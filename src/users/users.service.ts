import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import * as bcrypt from 'bcrypt';
import { Role } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async create(
    createUserDto: CreateUserDto,
    creatorRole?: Role,
    creatorId?: number,
  ) {
    const targetRole = createUserDto.role || Role.FARMER;

    if (targetRole === Role.ARTIA) {
      if (creatorRole !== Role.SADAR) {
        throw new BadRequestException(
          'Only a SADAR can create an ARTIA account.',
        );
      }
    } else if (targetRole === Role.FARMER) {
      if (creatorRole !== Role.ARTIA && creatorRole !== Role.SADAR) {
        throw new BadRequestException(
          'Only an ARTIA (or SADAR) can create a FARMER account.',
        );
      }
    }

    if (!createUserDto.phone && !createUserDto.email) {
      throw new BadRequestException('Either phone or email must be provided.');
    }

    // check existence
    if (createUserDto.phone) {
      const existing = await this.findByPhone(createUserDto.phone);
      if (existing) throw new BadRequestException('Phone already exists');
    }
    if (createUserDto.email) {
      const existing = await this.findByEmail(createUserDto.email);
      if (existing) throw new BadRequestException('Email already exists');
    }

    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        name: createUserDto.name,
        password: hashedPassword,
        phone: createUserDto.phone,
        email: createUserDto.email,
        role: targetRole,
        createdBy: creatorId,
      },
    });
    const { password, ...result } = user;
    return result;
  }

  async findByPhone(phone: string) {
    return this.prisma.user.findUnique({ where: { phone } });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findById(id: number) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async update(id: number, data: any) {
    return this.prisma.user.update({
      where: { id },
      data,
    });
  }

  async socialCreate(
    createUserDto: CreateUserDto,
    creatorRole?: Role,
    creatorId?: number,
  ) {}
}
