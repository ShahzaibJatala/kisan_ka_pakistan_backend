import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { BypassService } from '../bypass/bypass.service';
import { CreateSuperAdminDto } from '../auth/dto/super-admin.dto';

const manageableRoles: Role[] = [Role.FARMER, Role.ARTIA, Role.SADAR];

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService, private readonly bypassService: BypassService) {}

  async superAdmins() {
    return this.prisma.user.findMany({
      where: { role: Role.SUPER_ADMIN },
      select: { id: true, name: true, email: true, phone: true, status: true, createdAt: true, verifiedAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createSuperAdmin(dto: CreateSuperAdminDto, creatorId: number) {
    const email = dto.email.trim().toLowerCase();
    const phone = dto.phone?.trim() || undefined;
    const conflict = await this.prisma.user.findFirst({
      where: { OR: [{ email }, ...(phone ? [{ phone }] : [])] },
      select: { id: true },
    });
    if (conflict) throw new ConflictException('An account already uses this email address or phone number.');

    const password = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: {
        name: dto.name.trim(), email, phone, password,
        role: Role.SUPER_ADMIN, status: UserStatus.VERIFIED,
        createdBy: creatorId, verifiedBy: creatorId, verifiedAt: new Date(),
      },
      select: { id: true, name: true, email: true, phone: true, status: true, createdAt: true, verifiedAt: true },
    });
    return user;
  }

  async users(role?: Role, status?: UserStatus) {
    if (role && !manageableRoles.includes(role)) throw new BadRequestException('Unsupported user role.');
    return this.prisma.user.findMany({
      where: { ...(role ? { role } : { role: { in: manageableRoles } }), ...(status ? { status } : {}) },
      select: {
        id: true, name: true, email: true, phone: true, cnic: true, role: true, status: true, city: true, mandiId: true, createdAt: true,
        mandi: { select: { id: true, name: true, city: true } },
        artiaProfile: { select: { shopName: true } },
        farmerProfile: { select: { artia: { select: { id: true, name: true, artiaProfile: { select: { shopName: true } } } }, connections: { select: { artiaId: true, status: true, statusReason: true } } } },
        _count: { select: { artiaFarmers: true, farmerConnections: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async userDetails(id: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        mandi: { select: { id: true, name: true, city: true } },
        artiaProfile: true,
        farmerProfile: {
          include: {
            mandi: { select: { id: true, name: true, city: true } },
            artia: {
              select: {
                id: true,
                name: true,
                phone: true,
                artiaProfile: { select: { shopName: true, shopPhone: true, address: true } },
              },
            },
            connections: {
              include: {
                artia: {
                  select: {
                    id: true,
                    name: true,
                    phone: true,
                    artiaProfile: { select: { shopName: true } },
                  },
                },
              },
            },
          },
        },
        pesticideOwnedShops: { select: { id: true, name: true, slug: true, status: true } },
        _count: { select: { artiaFarmers: true, farmerConnections: true, createdUsers: true } },
      },
    });
    if (!user || !manageableRoles.includes(user.role)) throw new NotFoundException('Managed account not found.');
    const { password, refreshToken, resetOtp, ...safeUser } = user;
    return safeUser;
  }

  async updateUser(id: number, input: Record<string, unknown>) {
    const existing = await this.prisma.user.findUnique({ where: { id }, select: { id: true, role: true } });
    if (!existing || !manageableRoles.includes(existing.role)) throw new NotFoundException('Managed account not found.');

    const text = (value: unknown) => typeof value === 'string' ? value.trim() || null : undefined;
    const userData: Record<string, string | number | null> = {};
    for (const field of ['name', 'phone', 'email', 'cnic', 'address', 'city']) {
      const value = text(input[field]);
      if (value !== undefined) userData[field] = value;
    }
    if (input.mandiId !== undefined) {
      const mandiId = Number(input.mandiId);
      if (!Number.isInteger(mandiId) || mandiId < 1) throw new BadRequestException('Please select a valid mandi.');
      userData.mandiId = mandiId;
    }
    try {
      await this.prisma.$transaction(async tx => {
        await tx.user.update({ where: { id }, data: userData });
        if (existing.role === Role.ARTIA && input.artiaProfile && typeof input.artiaProfile === 'object') {
          const profile = input.artiaProfile as Record<string, unknown>;
          const profileData: Record<string, string | null> = {};
          for (const field of ['shopName', 'shopPhone', 'secondPhone', 'address', 'commissionRules']) {
            const value = text(profile[field]);
            if (value !== undefined) profileData[field] = value;
          }
          if (Object.keys(profileData).length) {
            await tx.artiaProfile.upsert({ where: { userId: id }, create: { userId: id, ...profileData }, update: profileData });
          }
        }
      });
    } catch (error: any) {
      if (error?.code === 'P2002') throw new ConflictException('Phone number, email, or CNIC is already used by another account.');
      throw error;
    }
    return this.userDetails(id);
  }

  async setStatus(id: number, status: UserStatus, reason?: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || !manageableRoles.includes(user.role)) throw new NotFoundException('Managed account not found.');
    return this.prisma.user.update({ where: { id }, data: { status, statusReason: reason?.trim() || null, verifiedAt: status === UserStatus.VERIFIED ? new Date() : user.verifiedAt } });
  }

  async stats() {
    const [mandis, artias, farmers, pendingArtias, pendingFarmers] = await Promise.all([
      this.prisma.mandi.count(), this.prisma.user.count({ where: { role: Role.ARTIA } }), this.prisma.user.count({ where: { role: Role.FARMER } }),
      this.prisma.user.count({ where: { role: Role.ARTIA, status: UserStatus.PENDING } }),
      this.prisma.user.count({ where: { role: Role.FARMER, status: UserStatus.PENDING } }),
    ]);
    return { totalMandis: mandis, totalArtias: artias, totalFarmers: farmers, pendingArtias, pendingFarmers };
  }

  async mandis() {
    const mandis = await this.prisma.mandi.findMany({
      include: {
        users: { where: { role: Role.SADAR }, select: { id: true, name: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return mandis.map(({ users, ...mandi }) => ({ ...mandi, sadar: users[0] ?? null }));
  }

  async pendingLimitRequests() {
    return this.prisma.joinBypassRequest.findMany({
      where: { targetRole: 'SUPER_ADMIN', status: 'PENDING' },
      include: { targetArtia: { select: { name: true, mandi: { select: { name: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  approveLimitRequest(id: number, adminId: number, reason?: string) { return this.bypassService.approveBypassRequest(id, adminId, reason); }
  rejectLimitRequest(id: number, adminId: number, reason?: string) { return this.bypassService.rejectBypassRequest(id, adminId, reason); }

  async setFarmerConnectionStatus(farmerUserId: number, artiaId: number, status: 'ACTIVE' | 'SUSPENDED', reason?: string) {
    const farmer = await this.prisma.farmerProfile.findUnique({ where: { userId: farmerUserId } });
    const artia = await this.prisma.user.findFirst({ where: { id: artiaId, role: Role.ARTIA } });
    if (!farmer || !artia) throw new NotFoundException('Farmer or Artia connection not found.');
    return this.prisma.farmerArtiaConnection.upsert({
      where: { farmerId_artiaId: { farmerId: farmer.id, artiaId } },
      create: { farmerId: farmer.id, artiaId, phone: null, status, statusReason: reason?.trim() || null },
      update: { status, statusReason: reason?.trim() || null },
    });
  }
}
