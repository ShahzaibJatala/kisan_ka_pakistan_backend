import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
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

@Injectable()
export class FarmerService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('otp-queue') private readonly otpQueue: Queue,
    @InjectQueue('price-aggregation')
    private readonly priceAggregationQueue: Queue,
    private jwtService: JwtService,
    private mailService: MailService,
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

    // 2. Check if CNIC is exactly an 11-digit number
    // (Change \d{11} to \d{13} if you need standard PK CNIC length)
    // let initialStatus: UserStatus = UserStatus.PENDING;
    // if (cnic && /^\d{13}$/.test(cnic)) {
    //   initialStatus = UserStatus.VERIFIED;
    // }

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
          status: UserStatus.PENDING, // 3. Fixed: Actually passing the calculated status here
          isOtpVerified: false,
        },
      });

      // Create linked FarmerProfile
      // Link artiaId if provided, otherwise link mandiId if provided
      const profile = await tx.farmerProfile.create({
        data: {
          userId: user.id,
          artiaId: artiaId || null,
          mandiId: artiaId ? null : mandiId || null,
        },
      });

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

    // Verify URL
    const verifyUrl = `${process.env.BACKEND_URL}/users/confirm-verification?token=${token}`;

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
        farmerProfile: true,
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
  async getLedger(userId: number) {
    const profile = await this.prisma.farmerProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new NotFoundException('Farmer profile not found');
    }

    const ledgers = await this.prisma.farmerLedger.findMany({
      where: { farmerId: profile.id },
      include: {
        transactions: {
          orderBy: { createdAt: 'desc' },
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

    return ledger;
  }

  /**
   * 7. Artia adds a transaction to a farmer's ledger (POST /farmers/ledgers/:ledgerId/transactions)
   */
  async addTransaction(artiaId: number, ledgerId: number, dto: AddTransactionDto) {
    // Verify the ledger was created by this artia
    const ledger = await this.prisma.farmerLedger.findFirst({
      where: { id: ledgerId, createdByArtiaId: artiaId },
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
      },
    });

    return transaction;
  }

  /**
   * 8. Artia views all their farmers with their ledgers (GET /farmers/artia/dashboard)
   */
  async getArtiaFarmersDashboard(artiaId: number) {
    const profiles = await this.prisma.farmerProfile.findMany({
      where: { artiaId },
      include: {
        user: {
          select: {
            id: true, name: true, phone: true, email: true,
            profileImage: true, city: true, address: true, status: true,
          },
        },
        mandi: true,
        ledgers: {
          include: {
            transactions: { orderBy: { createdAt: 'desc' } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    return profiles.map(profile => {
      const ledgersWithBalance = profile.ledgers.map(ledger => {
        const balance = ledger.transactions.reduce((sum, tx) => {
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
      where: { userId: farmerUserId, artiaId },
      include: { user: { select: { id: true, name: true, phone: true, email: true } } },
    });

    if (!profile) {
      throw new NotFoundException(
        'Farmer not found or does not belong to your account.',
      );
    }

    const ledgers = await this.prisma.farmerLedger.findMany({
      where: { farmerId: profile.id },
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

    return { farmer: profile.user, ledgers: ledgersWithBalance };
  }

  /**
   * 10. Artia edits a ledger (PATCH /farmers/ledgers/:ledgerId)
   */
  async updateLedger(artiaId: number, ledgerId: number, dto: UpdateLedgerDto) {
    // Verify the ledger belongs to this artia
    const ledger = await this.prisma.farmerLedger.findFirst({
      where: { id: ledgerId, createdByArtiaId: artiaId },
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
}
