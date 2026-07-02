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

@Injectable()
export class FarmerService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('otp-queue') private readonly otpQueue: Queue,
    @InjectQueue('price-aggregation')
    private readonly priceAggregationQueue: Queue,
  ) {}

  /**
   * 1. Self-Registration (POST /farmers/register)
   */
  async register(dto: RegisterFarmerDto) {
    const { phone, cnic, password, name, mandiId, artiaId } = dto;

    // Check if phone or cnic is already registered
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
          cnic,
          password: hashedPassword,
          name,
          role: Role.FARMER,
          status: UserStatus.PENDING,
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

    return {
      message: 'Registration successful. Verification OTP sent.',
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
   * 5. View Ledger (GET /farmers/me/ledger)
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
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return ledgers;
  }
}
