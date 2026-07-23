import { Injectable, ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role, UserStatus } from '@prisma/client';

@Injectable()
export class BypassService {
  constructor(private prisma: PrismaService) {}

  /**
   * 1. Validate phone number uniqueness across different physical farmers (different CNICs)
   */
  async validatePhoneUniqueness(phone: string, currentCnic: string): Promise<void> {
    if (!phone) return;
    const sanitizedPhone = phone.trim();

    // Check base user logins of other farmers
    const userConflict = await this.prisma.user.findFirst({
      where: {
        role: Role.FARMER,
        cnic: { not: currentCnic },
        phone: sanitizedPhone,
      },
    });

    if (userConflict) {
      throw new ConflictException(
        'This phone number is already registered under another farmer account.',
      );
    }

    // Check connection-specific phone numbers of other farmers
    const connectionConflict = await this.prisma.farmerArtiaConnection.findFirst({
      where: {
        phone: sanitizedPhone,
        farmer: {
          user: {
            cnic: { not: currentCnic },
          },
        },
      },
    });

    if (connectionConflict) {
      throw new ConflictException(
        'This phone number is already registered under another farmer account.',
      );
    }
  }

  /**
   * 2. Checks if a farmer is allowed to join a specific Artia
   */
  async checkFarmerJoinLimits(
    farmerProfileId: number,
    targetArtiaId: number,
    farmerCnic: string,
  ): Promise<{ allowed: boolean; reason?: 'SAME_MANDI' | 'MAX_ARTIAS' }> {
    const targetArtia = await this.prisma.user.findUnique({
      where: { id: targetArtiaId },
    });
    if (!targetArtia) {
      throw new NotFoundException('Target Artia not found');
    }

    const [storedConnections, farmerProfile] = await Promise.all([
      this.prisma.farmerArtiaConnection.findMany({
        where: { farmerId: farmerProfileId },
        include: { artia: true },
      }),
      this.prisma.farmerProfile.findUnique({
        where: { id: farmerProfileId },
        select: { artiaId: true },
      }),
    ]);

    // Farmers created before multi-Artia support have their first connection
    // only in FarmerProfile.artiaId. Treat it exactly like a join-table
    // connection so the same-Mandi and total limits apply consistently.
    const connections = [...storedConnections];
    if (farmerProfile?.artiaId && !connections.some((connection) => connection.artiaId === farmerProfile.artiaId)) {
      const primaryArtia = await this.prisma.user.findUnique({ where: { id: farmerProfile.artiaId } });
      if (primaryArtia) connections.push({
        id: 0,
        farmerId: farmerProfileId,
        artiaId: primaryArtia.id,
        phone: null,
        status: 'ACTIVE',
        statusReason: null,
        createdAt: primaryArtia.createdAt,
        artia: primaryArtia,
      });
    }

    // Check if already connected
    if (connections.some((c) => c.artiaId === targetArtiaId)) {
      throw new BadRequestException('Farmer is already connected to this Artia.');
    }

    // Total-limit bypasses always require Super Admin, even if the target also
    // happens to be in a Mandi the farmer already uses.
    if (connections.length >= 2) {
      const approvedBypass = await this.prisma.joinBypassRequest.findFirst({
        where: { farmerCnic, targetArtiaId, status: 'APPROVED' },
      });
      if (!approvedBypass) return { allowed: false, reason: 'MAX_ARTIAS' };
    }

    // A. Check Same Mandi constraint (strictly max 1 Artia per Mandi)
    const sameMandi = connections.find((c) => c.artia?.mandiId === targetArtia.mandiId);
    if (sameMandi) {
      // Check if there is an approved bypass request
      const approvedBypass = await this.prisma.joinBypassRequest.findFirst({
        where: {
          farmerCnic,
          targetArtiaId,
          status: 'APPROVED',
        },
      });

      if (!approvedBypass) {
        return { allowed: false, reason: 'SAME_MANDI' };
      }
    }

    return { allowed: true };
  }

  /**
   * 3. Submit a new limit bypass request
   */
  async createBypassRequest(farmerUserId: number, dto: {
    farmerName: string;
    farmerPhone: string;
    farmerCnic: string;
    targetArtiaId?: number;
    targetArtiaPhone?: string;
    reason?: string;
    targetRole?: string;
  }) {
    const targetArtiaQuery = dto.targetArtiaId
      ? { id: dto.targetArtiaId }
      : dto.targetArtiaPhone
        ? { phone: dto.targetArtiaPhone.trim() }
        : null;
    if (!targetArtiaQuery) throw new BadRequestException('Target Artia phone number is required.');
    const [targetArtia, farmer] = await Promise.all([
      this.prisma.user.findUnique({ where: targetArtiaQuery }),
      this.prisma.user.findUnique({ where: { id: farmerUserId }, include: { farmerProfile: true } }),
    ]);
    if (!targetArtia || targetArtia.role !== Role.ARTIA) {
      throw new NotFoundException('Target Artia not found.');
    }
    if (!farmer?.farmerProfile || farmer.role !== Role.FARMER || !farmer.cnic || !farmer.phone) {
      throw new BadRequestException('A verified farmer profile with CNIC and phone is required.');
    }

    const sanitizedCnic = farmer.cnic.replace(/-/g, '');

    const limit = await this.checkFarmerJoinLimits(farmer.farmerProfile.id, targetArtia.id, sanitizedCnic);
    if (limit.allowed || !limit.reason) {
      throw new BadRequestException('A bypass request is only available after a connection limit is reached.');
    }
    const targetRole = limit.reason === 'MAX_ARTIAS' ? 'SUPER_ADMIN' : dto.targetRole === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'SADAR';

    // The request can carry a connection contact number, while the name and
    // CNIC always come from the authenticated farmer profile.
    const contactPhone = dto.farmerPhone?.trim() || farmer.phone;
    if (!/^\d{11}$/.test(contactPhone)) {
      throw new BadRequestException('Contact phone number must contain exactly 11 digits.');
    }
    await this.validatePhoneUniqueness(contactPhone, sanitizedCnic);

    const duplicate = await this.prisma.joinBypassRequest.findFirst({
      where: { farmerCnic: sanitizedCnic, targetArtiaId: targetArtia.id, status: 'PENDING' },
    });
    if (duplicate) throw new ConflictException('A bypass request for this Artia is already pending.');

    // Create request
    const request = await this.prisma.joinBypassRequest.create({
      data: {
        farmerName: farmer.name,
        farmerPhone: contactPhone,
        farmerCnic: sanitizedCnic,
        targetArtiaId: targetArtia.id,
        reason: dto.reason || null,
        targetRole,
      },
    });

    // Notify Sadar or Super Admin
    if (request.targetRole === 'SADAR') {
      const sadars = await this.prisma.user.findMany({
        where: { role: Role.SADAR, mandiId: targetArtia.mandiId },
      });
      for (const sadar of sadars) {
        await this.prisma.notification.create({
          data: {
            userId: sadar.id,
            type: 'BYPASS_REQUEST',
            title_en: 'New Limit Bypass Request',
            title_ur: 'بائی پاس کی نئی درخواست',
            body_en: `Farmer ${dto.farmerName} (CNIC: ${dto.farmerCnic}) requested to join Artia ${targetArtia.name}. Reason: ${dto.reason || 'None'}`,
            body_ur: `کسان ${dto.farmerName} (شناختی کارڈ: ${dto.farmerCnic}) نے آڑھتی ${targetArtia.name} سے منسلک ہونے کی درخواست کی ہے۔ وجہ: ${dto.reason || 'کوئی نہیں'}`,
            metadata: JSON.stringify({ requestId: request.id }),
          },
        });
      }
    } else {
      const admins = await this.prisma.user.findMany({
        where: { role: Role.SUPER_ADMIN },
      });
      for (const admin of admins) {
        await this.prisma.notification.create({
          data: {
            userId: admin.id,
            type: 'BYPASS_REQUEST',
            title_en: 'New Limit Bypass Request',
            title_ur: 'بائی پاس کی نئی درخواست',
            body_en: `Farmer ${dto.farmerName} (CNIC: ${dto.farmerCnic}) requested to join Artia ${targetArtia.name}. Reason: ${dto.reason || 'None'}`,
            body_ur: `کسان ${dto.farmerName} (شناختی کارڈ: ${dto.farmerCnic}) نے آڑھتی ${targetArtia.name} سے منسلک ہونے کی درخواست کی ہے۔ وجہ: ${dto.reason || 'کوئی نہیں'}`,
            metadata: JSON.stringify({ requestId: request.id }),
          },
        });
      }
    }

    return request;
  }

  /**
   * 4. Retrieve bypass requests for Sadar or Super Admin
   */
  async getBypassRequests(user: { id: number; role: Role; mandiId?: number }) {
    if (user.role === Role.SADAR) {
      return this.prisma.joinBypassRequest.findMany({
        where: {
          targetRole: 'SADAR',
          targetArtia: {
            mandiId: user.mandiId,
          },
        },
        include: {
          targetArtia: {
            select: {
              name: true,
              mandi: {
                select: { name: true, city: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    } else if (user.role === Role.SUPER_ADMIN) {
      return this.prisma.joinBypassRequest.findMany({
        where: {
          targetRole: 'SUPER_ADMIN',
        },
        include: {
          targetArtia: {
            select: {
              name: true,
              mandi: {
                select: { name: true, city: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    }
    return [];
  }

  /**
   * 5. Approve a bypass request
   */
  async approveBypassRequest(requestId: number, approverId: number, reason?: string) {
    const request = await this.prisma.joinBypassRequest.findUnique({
      where: { id: requestId },
    });
    if (!request || request.status !== 'PENDING') {
      throw new NotFoundException('Bypass request not found');
    }
    const approver = await this.prisma.user.findUnique({ where: { id: approverId } });
    const target = await this.prisma.user.findUnique({ where: { id: request.targetArtiaId } });
    if (!approver || !target || (request.targetRole === 'SADAR' && (approver.role !== Role.SADAR || approver.mandiId !== target.mandiId)) || (request.targetRole === 'SUPER_ADMIN' && approver.role !== Role.SUPER_ADMIN)) {
      throw new BadRequestException('You are not authorized to approve this request.');
    }

    const farmer = await this.prisma.user.findFirst({
      where: { role: Role.FARMER, cnic: request.farmerCnic },
      include: { farmerProfile: true },
    });
    if (!farmer?.farmerProfile) throw new NotFoundException('Farmer profile for this request was not found.');

    // Approval is the final verification step for an extra connection. Only at
    // this point does the farmer become connected to the requested Artia.
    await this.prisma.$transaction(async (tx) => {
      await tx.joinBypassRequest.update({ where: { id: requestId }, data: { status: 'APPROVED', approvedById: approverId, decisionReason: reason?.trim() || null } });
      await tx.farmerArtiaConnection.upsert({
        where: { farmerId_artiaId: { farmerId: farmer.farmerProfile!.id, artiaId: target.id } },
        create: { farmerId: farmer.farmerProfile!.id, artiaId: target.id, phone: request.farmerPhone },
        update: { phone: request.farmerPhone },
      });
      await tx.connectionRequest.upsert({
        where: { artiaId_farmerId: { artiaId: target.id, farmerId: farmer.id } },
        create: { artiaId: target.id, farmerId: farmer.id, status: 'ACCEPTED' },
        update: { status: 'ACCEPTED' },
      });
      if (!farmer.farmerProfile!.mandiId) {
        await tx.farmerProfile.update({ where: { id: farmer.farmerProfile!.id }, data: { mandiId: target.mandiId } });
      }
      if (!farmer.mandiId) {
        await tx.user.update({ where: { id: farmer.id }, data: { mandiId: target.mandiId } });
      }
    });
    return { success: true };
  }

  /**
   * 6. Reject a bypass request
   */
  async rejectBypassRequest(requestId: number, approverId: number, reason?: string) {
    const request = await this.prisma.joinBypassRequest.findUnique({
      where: { id: requestId },
    });
    if (!request || request.status !== 'PENDING') {
      throw new NotFoundException('Bypass request not found');
    }
    const approver = await this.prisma.user.findUnique({ where: { id: approverId } });
    const target = await this.prisma.user.findUnique({ where: { id: request.targetArtiaId } });
    if (!approver || !target || (request.targetRole === 'SADAR' && (approver.role !== Role.SADAR || approver.mandiId !== target.mandiId)) || (request.targetRole === 'SUPER_ADMIN' && approver.role !== Role.SUPER_ADMIN)) {
      throw new BadRequestException('You are not authorized to reject this request.');
    }

    await this.prisma.joinBypassRequest.update({
      where: { id: requestId },
      data: { status: 'REJECTED', approvedById: approverId, decisionReason: reason?.trim() || null },
    });
  }
}
