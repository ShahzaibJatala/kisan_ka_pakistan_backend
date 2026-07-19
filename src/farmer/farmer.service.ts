import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterFarmerDto } from './dto/register-farmer.dto';
import { UpdateFarmerProfileDto } from './dto/update-farmer-profile.dto';
import { PostCropPriceDto } from './dto/post-crop-price.dto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as bcrypt from 'bcrypt';
import { Role, UserStatus } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { MailService } from '../mail/mail.service';
import { CreateLedgerDto } from './dto/create-ledger.dto';
import { UpdateLedgerDto } from './dto/update-ledger.dto';
import { AddTransactionDto } from './dto/add-transaction.dto';
import { LedgerGateway } from './ledger.gateway';
import { BypassService } from '../bypass/bypass.service';

@Injectable()
export class FarmerService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('otp-queue') private readonly otpQueue: Queue,
    @InjectQueue('price-aggregation')
    private readonly priceAggregationQueue: Queue,
    private jwtService: JwtService,
    private mailService: MailService,
    private ledgerGateway: LedgerGateway,
    private bypassService: BypassService,
  ) {}

  /**
   * 1. Self-Registration (POST /farmers/register)
   */
  async register(dto: RegisterFarmerDto) {
    let { phone, cnic, password, name, mandiId, artiaId } = dto;

    // 1. Sanitize the CNIC immediately by removing all dashes
    if (cnic) {
      cnic = cnic.replace(/-/g, ''); 
    }

    // Validate phone number uniqueness across all other farmers
    if (phone) {
      await this.bypassService.validatePhoneUniqueness(phone, cnic || '');
    }

    // Check if phone or sanitized cnic is already registered
    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [{ phone }, { cnic }],
      },
    });

    if (existingUser) {
      throw new ConflictException(
        'A user with this phone number or CNIC already exists',
      );
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Perform database operations in a transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // Create User
      const user = await tx.user.create({
        data: {
          phone,
          cnic, // Saves the clean, dash-free CNIC to the DB
          password: hashedPassword,
          name,
          role: Role.FARMER,
          status: UserStatus.PENDING,
          isOtpVerified: false,
        },
      });

      // Create linked FarmerProfile
      const profile = await tx.farmerProfile.create({
        data: {
          userId: user.id,
          artiaId: artiaId || null,
          mandiId: artiaId ? null : mandiId || null,
        },
      });

      if (artiaId) {
        // Validate limits
        const limitResult = await this.bypassService.checkFarmerJoinLimits(
          profile.id,
          artiaId,
          cnic || '',
        );

        if (!limitResult.allowed) {
          throw new BadRequestException({
            error: 'LIMIT_HIT',
            reason: limitResult.reason,
          });
        }

        // Create connection
        await tx.farmerArtiaConnection.create({
          data: {
            farmerId: profile.id,
            artiaId,
            phone,
          },
        });

        // Set profile mandiId if not set
        const artia = await tx.user.findUnique({ where: { id: artiaId } });
        if (artia?.mandiId) {
          await tx.farmerProfile.update({
            where: { id: profile.id },
            data: { mandiId: artia.mandiId },
          });
          await tx.user.update({
            where: { id: user.id },
            data: { mandiId: artia.mandiId },
          });
        }
      }

      return { user, profile };
    });

    // Dispatch an OTP SMS job to otp-queue
    await this.otpQueue.add('sendOtpSms', {
      userId: result.user.id,
      phone: result.user.phone,
      name: result.user.name,
    });

    // Send verification email to Super Admin
    const superAdminEmail = process.env.SUPER_ADMIN_EMAIL || '';
    const superAdmin = await this.prisma.user.findFirst({
      where: { role: Role.SUPER_ADMIN },
    });
    
    const verifierId = superAdmin ? superAdmin.id : 1;

    // Generate confirmation token (JWT payload with verifier verification type)
    const payload = {
      userId: result.user.id,
      verifierId: verifierId,
      type: 'confirm-verification',
    };
    const token = this.jwtService.sign(payload, { expiresIn: '7d' });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const verifyUrl = `${frontendUrl}/verify-user?token=${token}`;

    if (superAdminEmail) {
      await this.mailService.sendVerificationRequestMail(superAdminEmail, result.user, verifyUrl);
    }

    return {
      message: 'Registration successful. A verification request email has been sent to Super Admin.',
      userId: result.user.id,
    };
  }

  /**
   * 2. Get Own Profile (GET /farmers/me)
   */
  async getProfile(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        farmerProfile: {
          include: {
            connections: {
              include: {
                artia: {
                  select: {
                    id: true,
                    name: true,
                    mandi: {
                      select: { name: true, city: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User profile not found');
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, ...safeUser } = user;
    return safeUser;
  }

  /**
   * 3. Update Profile / Privacy Consent (PATCH /farmers/me)
   */
  async updateProfile(userId: number, dto: UpdateFarmerProfileDto) {
    const { address, city, profileImage, landSize, showOnArtiaProfile } = dto;

    const userWithProfile = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { farmerProfile: true },
    });

    if (!userWithProfile || !userWithProfile.farmerProfile) {
      throw new NotFoundException('Farmer profile not found');
    }

    const currentConsent = userWithProfile.farmerProfile.showOnArtiaProfile;
    const isConsentToggled =
      showOnArtiaProfile !== undefined && showOnArtiaProfile !== currentConsent;

    const userUpdates: {
      address?: string | null;
      city?: string | null;
      profileImage?: string | null;
    } = {};
    if (address !== undefined) userUpdates.address = address;
    if (city !== undefined) userUpdates.city = city;
    if (profileImage !== undefined) userUpdates.profileImage = profileImage;

    const profileUpdates: {
      landSize?: number | null;
      showOnArtiaProfile?: boolean;
      consentUpdatedAt?: Date | null;
    } = {};
    if (landSize !== undefined) profileUpdates.landSize = landSize;
    if (showOnArtiaProfile !== undefined) {
      profileUpdates.showOnArtiaProfile = showOnArtiaProfile;
      if (isConsentToggled) {
        profileUpdates.consentUpdatedAt = new Date();
      }
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...userUpdates,
        farmerProfile:
          Object.keys(profileUpdates).length > 0
            ? {
                update: profileUpdates,
              }
            : undefined,
      },
      include: {
        farmerProfile: true,
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, ...safeUser } = updatedUser;
    return safeUser;
  }

  /**
   * 4. Post Crop Price (POST /farmers/prices)
   */
  async postCropPrice(userId: number, dto: PostCropPriceDto) {
    const { cropId, mandiId, price, unit } = dto;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // CRITICAL RULE: Check if user.status === VERIFIED
    if (user.status !== UserStatus.VERIFIED) {
      throw new ForbiddenException(
        'Your account must be verified by an Artia or Sadar to post prices',
      );
    }

    // Save the raw price to the database
    const savedPrice = await this.prisma.price.create({
      data: {
        price,
        cropId,
        mandiId,
        unit,
        userId,
      },
    });

    // Dispatch an event to the price-aggregation queue to recompute daily aggregates
    await this.priceAggregationQueue.add('recomputeDailyAggregates', {
      priceId: savedPrice.id,
      cropId,
      mandiId,
      price,
      unit,
      userId,
    });

    return savedPrice;
  }

  /**
   * 5. Farmer views their own ledgers (GET /farmers/me/ledgers)
   */
  async getLedger(userId: number, artiaId?: number) {
    const profile = await this.prisma.farmerProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new NotFoundException('Farmer profile not found');
    }

    if (artiaId) {
      const connection = await this.prisma.farmerArtiaConnection.findUnique({
        where: { farmerId_artiaId: { farmerId: profile.id, artiaId } },
      });
      if (!connection) throw new NotFoundException('Artia connection not found');
    }

    const ledgers = await this.prisma.farmerLedger.findMany({
      where: { farmerId: profile.id, ...(artiaId ? { createdByArtiaId: artiaId } : {}) },
      include: {
        transactions: {
          orderBy: { createdAt: 'desc' },
        },
        createdByArtia: {
          select: {
            id: true,
            name: true,
            artiaProfile: {
              select: {
                shopName: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Compute balance per ledger
    return ledgers.map(ledger => {
      const balance = ledger.transactions.reduce((sum, tx) => {
        return tx.type === 'CREDIT' ? sum + tx.amount : sum - tx.amount;
      }, 0);
      return { ...ledger, balance };
    });
  }

  async getConnections(userId: number) {
    const profile = await this.prisma.farmerProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Farmer profile not found');
    const connections = await this.prisma.farmerArtiaConnection.findMany({
      where: { farmerId: profile.id },
      include: {
        artia: {
          select: {
            id: true, name: true, phone: true, mandiId: true,
            mandi: { select: { id: true, name: true, city: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return connections.map(({ id, phone, createdAt, artia }) => ({
      id, phone, createdAt, artia,
    }));
  }

  /**
   * 6. Artia creates a new ledger for a specific farmer (POST /farmers/:farmerId/ledgers)
   */
  async createLedger(artiaId: number, farmerUserId: number, dto: CreateLedgerDto) {
    // Confirm farmer profile exists and belongs to this artia
    const profile = await this.prisma.farmerProfile.findFirst({
      where: { userId: farmerUserId, artiaId },
    });

    if (!profile) {
      throw new NotFoundException(
        'Farmer not found or does not belong to your account.',
      );
    }

    const ledger = await this.prisma.farmerLedger.create({
      data: {
        name: dto.name,
        season: dto.season || null,
        cropName: dto.cropName || null,
        description: dto.description || null,
        farmerId: profile.id,
        createdByArtiaId: artiaId,
      },
    });

    // Create DB Notification for farmer
    await this.prisma.notification.create({
      data: {
        userId: farmerUserId,
        type: 'LEDGER_CREATED',
        title_en: 'New Ledger Created',
        title_ur: 'نیا کھاتہ بنایا گیا',
        body_en: `A new ledger "${ledger.name}" has been created for you.`,
        body_ur: `آپ کے لیے ایک نیا کھاتہ "${ledger.name}" بنایا گیا ہے۔`,
        metadata: JSON.stringify({ ledgerId: ledger.id }),
      },
    });

    // Emit WebSocket notification to farmer
    this.ledgerGateway.emitToFarmer(farmerUserId, 'ledger:created', ledger);

    return ledger;
  }

  /**
   * 7. Artia adds a transaction to a farmer's ledger (POST /farmers/ledgers/:ledgerId/transactions)
   */
  async addTransaction(artiaId: number, ledgerId: number, dto: AddTransactionDto) {
    // Verify the ledger was created by this artia
    const ledger = await this.prisma.farmerLedger.findFirst({
      where: { id: ledgerId, createdByArtiaId: artiaId },
      include: { farmer: true },
    });

    if (!ledger) {
      throw new NotFoundException(
        'Ledger not found or you do not have permission to manage it.',
      );
    }

    const transaction = await this.prisma.transaction.create({
      data: {
        ledgerId,
        amount: dto.amount,
        type: dto.type,
        description: dto.description || null,
        crop: dto.crop || null,
        quantity: dto.quantity !== undefined ? dto.quantity : null,
        rate: dto.rate !== undefined ? dto.rate : null,
        gross: dto.gross !== undefined ? dto.gross : null,
        commission: dto.commission !== undefined ? dto.commission : null,
        expenses: dto.expenses !== undefined ? dto.expenses : null,
        net: dto.net !== undefined ? dto.net : null,
      },
    });

    // Create DB Notification for farmer
    await this.prisma.notification.create({
      data: {
        userId: ledger.farmer.userId,
        type: 'TRANSACTION_ADDED',
        title_en: 'New Transaction Added',
        title_ur: 'نئی ٹرانزیکشن شامل کی گئی',
        body_en: `A transaction of PKR ${dto.amount} (${dto.type}) was added to ledger "${ledger.name}".`,
        body_ur: `کھاتہ "${ledger.name}" میں PKR ${dto.amount} (${dto.type}) کی ٹرانزیکشن شامل کی گئی ہے۔`,
        metadata: JSON.stringify({ ledgerId, transactionId: transaction.id }),
      },
    });

    // Emit WebSocket notification to farmer
    this.ledgerGateway.emitToFarmer(ledger.farmer.userId, 'transaction:added', transaction);

    return transaction;
  }

  /**
   * 8. Artia views all their farmers with their ledgers (GET /farmers/artia/dashboard)
   */
  async getArtiaFarmersDashboard(artiaId: number) {
    const profiles = await this.prisma.farmerProfile.findMany({
      where: {
        connections: {
          some: { artiaId },
        },
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            profileImage: true,
            city: true,
            address: true,
            status: true,
          },
        },
        mandi: true,
        connections: {
          where: { artiaId },
        },
        ledgers: {
          where: { createdByArtiaId: artiaId },
          include: {
            transactions: { orderBy: { createdAt: 'desc' } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    return (profiles as any[]).map((profile: any) => {
      const connectionPhone = profile.connections?.[0]?.phone;
      if (profile.user && connectionPhone) {
        profile.user.phone = connectionPhone;
      }
      const ledgersWithBalance = (profile.ledgers || []).map((ledger: any) => {
        const balance = (ledger.transactions || []).reduce((sum: number, tx: any) => {
          return tx.type === 'CREDIT' ? sum + tx.amount : sum - tx.amount;
        }, 0);
        return { ...ledger, balance };
      });
      return { ...profile, ledgers: ledgersWithBalance };
    });
  }

  /**
   * 9. Artia views ledgers of one specific farmer (GET /farmers/:farmerId/ledgers)
   */
  async getFarmerLedgers(artiaId: number, farmerUserId: number) {
    const profile = await this.prisma.farmerProfile.findFirst({
      where: {
        userId: farmerUserId,
        connections: {
          some: { artiaId },
        },
      },
      include: {
        user: { select: { id: true, name: true, phone: true, email: true } },
        connections: {
          where: { artiaId },
        },
      },
    });

    if (!profile) {
      throw new NotFoundException(
        'Farmer not found or does not belong to your account.',
      );
    }

    const connectionPhone = (profile as any).connections?.[0]?.phone;
    if (profile.user && connectionPhone) {
      (profile.user as any).phone = connectionPhone;
    }

    const ledgers = await this.prisma.farmerLedger.findMany({
      where: { farmerId: profile.id, createdByArtiaId: artiaId },
      include: {
        transactions: { orderBy: { createdAt: 'desc' } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const ledgersWithBalance = ledgers.map((ledger: any) => {
      const balance = (ledger.transactions || []).reduce((sum: number, tx: any) => {
        return tx.type === 'CREDIT' ? sum + tx.amount : sum - tx.amount;
      }, 0);
      return { ...ledger, balance };
    });

    return { farmer: profile.user, ledgers: ledgersWithBalance };
  }

  /**
   * 10. Artia edits a ledger (PATCH /farmers/ledgers/:ledgerId)
   */
  async updateLedger(artiaId: number, ledgerId: number, dto: UpdateLedgerDto) {
    // Verify the ledger belongs to this artia
    const ledger = await this.prisma.farmerLedger.findFirst({
      where: { id: ledgerId, createdByArtiaId: artiaId },
      include: { farmer: true },
    });

    if (!ledger) {
      throw new NotFoundException(
        'Ledger not found or you do not have permission to edit it.',
      );
    }

    const updated = await this.prisma.farmerLedger.update({
      where: { id: ledgerId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.season !== undefined && { season: dto.season }),
        ...(dto.cropName !== undefined && { cropName: dto.cropName }),
        ...(dto.description !== undefined && { description: dto.description }),
      },
      include: {
        transactions: { orderBy: { createdAt: 'desc' } },
      },
    });

    const balance = updated.transactions.reduce((sum, tx) => {
      return tx.type === 'CREDIT' ? sum + tx.amount : sum - tx.amount;
    }, 0);

    // Create DB Notification for farmer
    await this.prisma.notification.create({
      data: {
        userId: ledger.farmer.userId,
        type: 'LEDGER_UPDATED',
        title_en: 'Ledger Updated',
        title_ur: 'کھاتہ اپ ڈیٹ کیا گیا',
        body_en: `Ledger "${updated.name}" has been updated.`,
        body_ur: `کھاتہ "${updated.name}" اپ ڈیٹ کر دیا گیا ہے۔`,
        metadata: JSON.stringify({ ledgerId }),
      },
    });

    // Emit WebSocket notification to farmer
    this.ledgerGateway.emitToFarmer(ledger.farmer.userId, 'ledger:updated', { ...updated, balance });

    return { ...updated, balance };
  }

  /**
   * 11. Get or create personal ledger for an Artia (GET /farmers/personal-ledger)
   */
  async getOrCreatePersonalLedger(artiaId: number) {
    let ledger = await this.prisma.personalLedger.findUnique({
      where: { userId: artiaId },
      include: {
        transactions: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!ledger) {
      ledger = await this.prisma.personalLedger.create({
        data: {
          name: 'Personal Ledger',
          userId: artiaId,
        },
        include: {
          transactions: { orderBy: { createdAt: 'desc' } },
        },
      });
    }

    const balance = ledger.transactions.reduce((sum: number, tx: any) => {
      return tx.type === 'CREDIT' ? sum + tx.amount : sum - tx.amount;
    }, 0);

    return this.formatPersonalLedger(ledger, balance);
  }

  /**
   * 12. Update personal ledger metadata (PATCH /farmers/personal-ledger)
   */
  async updatePersonalLedger(artiaId: number, dto: UpdateLedgerDto) {
    const ledger = await this.prisma.personalLedger.findUnique({
      where: { userId: artiaId },
    });

    if (!ledger) {
      throw new NotFoundException('Personal ledger not found.');
    }

    const updated = await this.prisma.personalLedger.update({
      where: { userId: artiaId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
      },
      include: {
        transactions: { orderBy: { createdAt: 'desc' } },
      },
    });

    const balance = updated.transactions.reduce((sum: number, tx: any) => {
      return tx.type === 'CREDIT' ? sum + tx.amount : sum - tx.amount;
    }, 0);

    return this.formatPersonalLedger(updated, balance);
  }

  /**
   * 13. Add transaction to personal ledger (POST /farmers/personal-ledger/transactions)
   */
  async addPersonalTransaction(artiaId: number, dto: AddTransactionDto) {
    const ledger = await this.prisma.personalLedger.findUnique({
      where: { userId: artiaId },
    });

    if (!ledger) {
      throw new NotFoundException('Personal ledger not found.');
    }

    const transaction = await this.prisma.personalTransaction.create({
      data: {
        ledgerId: ledger.id,
        amount: dto.amount,
        type: dto.type,
        description: dto.description || null,
      },
    });

    return transaction;
  }

  private formatPersonalLedger(ledger: any, balance: number) {
    return {
      id: ledger.id,
      name: ledger.name,
      description: ledger.description,
      userId: ledger.userId,
      transactions: ledger.transactions || [],
      createdAt: ledger.createdAt,
      updatedAt: ledger.updatedAt,
      balance,
    };
  }

  /**
   * 14. Farmer leaves current artia (POST /farmers/leave-artia)
   */
  async leaveArtia(farmerUserId: number, artiaId: number) {
    const profile = await this.prisma.farmerProfile.findUnique({
      where: { userId: farmerUserId },
    });

    if (!profile) {
      throw new NotFoundException('Farmer profile not found');
    }

    const connection = await this.prisma.farmerArtiaConnection.findUnique({
      where: {
        farmerId_artiaId: {
          farmerId: profile.id,
          artiaId,
        },
      },
    });

    if (!connection) {
      throw new NotFoundException('Not connected to this Artia');
    }

    await this.prisma.$transaction(async (tx) => {
      // Create ArtiaFarmerHistory record
      await tx.artiaFarmerHistory.create({
        data: {
          farmerId: farmerUserId,
          artiaId: artiaId,
          leftBy: 'FARMER',
        },
      });

      // Delete connection
      await tx.farmerArtiaConnection.delete({
        where: { id: connection.id },
      });

      // Delete pending CONSENT_REQUEST notification
      await tx.notification.deleteMany({
        where: {
          userId: farmerUserId,
          type: 'CONSENT_REQUEST',
          metadata: { contains: `"artiaId":${artiaId}` },
        },
      });

      // Delete any pending ConnectionRequest between them
      await tx.connectionRequest.deleteMany({
        where: {
          artiaId: artiaId,
          farmerId: farmerUserId,
          status: 'PENDING',
        },
      });
    });

    // Invalidate Redis cache for artia profile
    await this.invalidateArtiaProfileCache(artiaId);

    return { message: 'Successfully left artia' };
  }

  /**
   * 15. Artia removes a farmer (POST /farmers/:farmerId/remove)
   */
  async removeFarmer(artiaUserId: number, farmerUserId: number) {
    const profile = await this.prisma.farmerProfile.findUnique({
      where: { userId: farmerUserId },
    });

    if (!profile) {
      throw new NotFoundException('Farmer not found');
    }

    const connection = await this.prisma.farmerArtiaConnection.findUnique({
      where: {
        farmerId_artiaId: {
          farmerId: profile.id,
          artiaId: artiaUserId,
        },
      },
    });

    if (!connection) {
      throw new NotFoundException('Farmer is not connected to your account');
    }

    await this.prisma.$transaction(async (tx) => {
      // Create ArtiaFarmerHistory record
      await tx.artiaFarmerHistory.create({
        data: {
          farmerId: farmerUserId,
          artiaId: artiaUserId,
          leftBy: 'ARTIA',
        },
      });

      // Delete connection
      await tx.farmerArtiaConnection.delete({
        where: { id: connection.id },
      });

      // Delete pending CONSENT_REQUEST notification
      await tx.notification.deleteMany({
        where: {
          userId: farmerUserId,
          type: 'CONSENT_REQUEST',
          metadata: { contains: `"artiaId":${artiaUserId}` },
        },
      });

      // Delete any pending ConnectionRequest between them
      await tx.connectionRequest.deleteMany({
        where: {
          artiaId: artiaUserId,
          farmerId: farmerUserId,
          status: 'PENDING',
        },
      });
    });

    // Invalidate Redis cache for artia profile
    await this.invalidateArtiaProfileCache(artiaUserId);

    return { message: 'Successfully removed farmer' };
  }

  async getLeftFarmers(artiaUserId: number) {
    const leftHistories = await this.prisma.artiaFarmerHistory.findMany({
      where: {
        artiaId: artiaUserId,
        farmer: {
          farmerProfile: {
            NOT: {
              artiaId: artiaUserId,
            },
          },
        },
      },
      include: {
        farmer: {
          include: {
            farmerProfile: true,
          },
        },
      },
      orderBy: { leftAt: 'desc' },
    });

    const result = await Promise.all(
      leftHistories.map(async (history: any) => {
        const farmerProfile = history.farmer.farmerProfile;
        if (!farmerProfile) return null;

        // Get ledgers between this artia and farmer
        const ledgers = await this.prisma.farmerLedger.findMany({
          where: {
            farmerId: farmerProfile.id,
            createdByArtiaId: artiaUserId,
          },
          include: {
            transactions: { orderBy: { createdAt: 'desc' } },
          },
          orderBy: { createdAt: 'desc' },
        });

        const ledgersWithBalance = ledgers.map(ledger => {
          const balance = ledger.transactions.reduce((sum, tx) => {
            return tx.type === 'CREDIT' ? sum + tx.amount : sum - tx.amount;
          }, 0);
          return { ...ledger, balance };
        });

        return {
          farmer: {
            id: history.farmer.id,
            name: history.farmer.name,
            phone: history.farmer.phone,
            email: history.farmer.email,
            profileImage: history.farmer.profileImage,
            city: history.farmer.city,
            status: history.farmer.status,
          },
          leftBy: history.leftBy,
          leftAt: history.leftAt,
          ledgers: ledgersWithBalance,
        };
      }),
    );

    return result.filter((item: any) => item !== null);
  }

  async getPreviousArtias(farmerUserId: number) {
    const farmerProfile = await this.prisma.farmerProfile.findUnique({
      where: { userId: farmerUserId },
    });

    const currentArtiaId = farmerProfile?.artiaId;

    const leftHistories = await this.prisma.artiaFarmerHistory.findMany({
      where: {
        farmerId: farmerUserId,
        ...(currentArtiaId && {
          NOT: {
            artiaId: currentArtiaId,
          },
        }),
      },
      include: {
        artia: {
          include: {
            artiaProfile: true,
          },
        },
      },
      orderBy: { leftAt: 'desc' },
    });

    const result = await Promise.all(
      leftHistories.map(async (history: any) => {
        const artiaProfile = history.artia.artiaProfile;
        if (!artiaProfile) return null;

        const farmerProfile = await this.prisma.farmerProfile.findUnique({
          where: { userId: farmerUserId },
        });

        if (!farmerProfile) return null;

        // Get ledgers between this farmer and artia
        const ledgers = await this.prisma.farmerLedger.findMany({
          where: {
            farmerId: farmerProfile.id,
            createdByArtiaId: history.artiaId,
          },
          include: {
            transactions: { orderBy: { createdAt: 'desc' } },
          },
          orderBy: { createdAt: 'desc' },
        });

        const ledgersWithBalance = ledgers.map(ledger => {
          const balance = ledger.transactions.reduce((sum, tx) => {
            return tx.type === 'CREDIT' ? sum + tx.amount : sum - tx.amount;
          }, 0);
          return { ...ledger, balance };
        });

        return {
          artia: {
            id: history.artia.id,
            name: history.artia.name,
            phone: history.artia.phone,
            email: history.artia.email,
            shopName: artiaProfile.shopName,
            shopPhone: artiaProfile.shopPhone,
            address: artiaProfile.address,
          },
          leftBy: history.leftBy,
          leftAt: history.leftAt,
          ledgers: ledgersWithBalance,
        };
      }),
    );

    return result.filter((item: any) => item !== null);
  }

  private async invalidateArtiaProfileCache(artiaId: number) {
    // This would typically use Redis, but for now we'll leave it as a placeholder
    // In production, you would do something like:
    // await this.redisService.del(`artia:profile:${artiaId}`);
  }
}
