import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateArtiaProfileDto } from './dto/update-artia-profile.dto';
import { UpdateFarmerPrivacyDto } from './dto/update-farmer-privacy.dto';
import { UpdateFarmerProfileDto } from './dto/update-farmer-profile.dto';
import * as bcrypt from 'bcrypt';
import { Role, UserStatus } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { MailService } from '../mail/mail.service';
import { RedisService } from '../redis/redis.service';
import { BypassService } from '../bypass/bypass.service';

// Cache TTL constants
const ARTIA_PROFILE_TTL = 86400;  // 24 hours
const ARTIA_LIST_TTL   = 108000; // 30 hours

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private mailService: MailService,
    private redisService: RedisService,
    private bypassService: BypassService,
  ) {}

  async create(
    createUserDto: CreateUserDto,
    creatorRole?: Role,
    creatorId?: number,
  ) {
    createUserDto.phone = createUserDto.phone?.trim() || undefined;
    createUserDto.email = createUserDto.email?.trim() || undefined;
    createUserDto.cnic = createUserDto.cnic?.trim() || undefined;

    const targetRole = createUserDto.role || Role.FARMER;

    if (targetRole === Role.ARTIA) {
      if (creatorRole !== Role.SADAR) {
        throw new BadRequestException(
          'Only a SADAR can create an ARTIA account.',
        );
      }
    } else if (targetRole === Role.FARMER) {
      if (creatorRole !== Role.ARTIA) {
        throw new BadRequestException(
          'Only an ARTIA can create a FARMER account.',
        );
      }
    }

    if (!createUserDto.phone && !createUserDto.email) {
      throw new BadRequestException('Either phone or email must be provided.');
    }

    const sanitizedCnic = createUserDto.cnic ? createUserDto.cnic.replace(/-/g, '') : null;

    // --- Farmer Specific Connection Logic ---
    if (targetRole === Role.FARMER && sanitizedCnic) {
      // Check if a farmer with this CNIC already exists
      const existingFarmer = await this.prisma.user.findFirst({
        where: { cnic: sanitizedCnic, role: Role.FARMER },
        include: { farmerProfile: true },
      });

      if (existingFarmer) {
        if (!existingFarmer.farmerProfile) {
          throw new BadRequestException('Farmer profile not found for this CNIC.');
        }

        // Validate phone uniqueness
        if (createUserDto.phone) {
          await this.bypassService.validatePhoneUniqueness(createUserDto.phone, sanitizedCnic);
        }

        if (creatorId === undefined) {
          throw new BadRequestException('Creator ID is required.');
        }

        // Check limits
        const limitResult = await this.bypassService.checkFarmerJoinLimits(
          existingFarmer.farmerProfile.id,
          creatorId,
          sanitizedCnic,
        );

        if (!limitResult.allowed) {
          throw new BadRequestException({
            error: 'LIMIT_HIT',
            reason: limitResult.reason,
          });
        }

        // Establish the new connection
        await this.prisma.farmerArtiaConnection.create({
          data: {
            farmerId: existingFarmer.farmerProfile.id,
            artiaId: creatorId,
            phone: createUserDto.phone || null,
          },
        });

        // Update profile mandiId if not set
        if (!existingFarmer.farmerProfile.mandiId) {
          const artia = await this.prisma.user.findUnique({ where: { id: creatorId } });
          if (artia?.mandiId) {
            await this.prisma.farmerProfile.update({
              where: { id: existingFarmer.farmerProfile.id },
              data: { mandiId: artia.mandiId },
            });
          }
        }

        const { password, ...result } = existingFarmer;
        return result;
      }
    }

    // check existence for new account
    if (createUserDto.phone) {
      const existing = await this.findByPhone(createUserDto.phone);
      if (existing) throw new BadRequestException('Phone already exists');
    }
    if (createUserDto.email) {
      const existing = await this.findByEmail(createUserDto.email);
      if (existing) throw new BadRequestException('Email already exists');
    }
    if (sanitizedCnic) {
      const existing = await this.prisma.user.findFirst({
        where: { cnic: sanitizedCnic },
      });
      if (existing) throw new BadRequestException('CNIC already exists');
    }

    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);

    // If an upper role is creating this user, they are automatically verified by that creator.
    // If not (e.g. self-registration in the future), they default to PENDING.
    const isCreatedByUpperRole = !!creatorId;
    const finalStatus = isCreatedByUpperRole ? UserStatus.VERIFIED : (createUserDto.status || UserStatus.PENDING);
    const verifiedBy = isCreatedByUpperRole ? creatorId : null;
    const verifiedAt = isCreatedByUpperRole ? new Date() : null;

    let finalMandiId = createUserDto.mandiId || null;
    if (targetRole === Role.ARTIA && creatorId && !finalMandiId) {
      const creator = await this.prisma.user.findUnique({
        where: { id: creatorId },
      });
      if (creator && creator.role === Role.SADAR) {
        finalMandiId = creator.mandiId;
      }
    }

    const user = await this.prisma.user.create({
      data: {
        name: createUserDto.name,
        password: hashedPassword,
        phone: createUserDto.phone,
        email: createUserDto.email,
        cnic: sanitizedCnic,
        role: targetRole,
        status: finalStatus,
        profileImage: createUserDto.profileImage,
        address: createUserDto.address,
        city: createUserDto.city,
        mandiId: finalMandiId,
        createdBy: creatorId,
        verifiedBy: verifiedBy,
        verifiedAt: verifiedAt,
      },
    });

    // --- Create FarmerProfile and Connection ---
    if (targetRole === Role.FARMER) {
      const artiaId = creatorRole === Role.ARTIA ? creatorId : null;
      const profile = await this.prisma.farmerProfile.create({
        data: {
          userId: user.id,
          artiaId: artiaId,
          mandiId: createUserDto.mandiId || null,
        }
      });

      if (artiaId) {
        await this.prisma.farmerArtiaConnection.create({
          data: {
            farmerId: profile.id,
            artiaId: artiaId,
            phone: createUserDto.phone || null,
          }
        });
      }
    }

    const { password, ...result } = user;

    // If verified by upper role, send them the success email with the dashboard login link
    if (isCreatedByUpperRole && user.email) {
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const loginUrl = frontendUrl.endsWith('/') ? `${frontendUrl}login` : `${frontendUrl}/login`;
      
      try {
        await this.mailService.sendVerificationSuccessMail(
          user.email,
          loginUrl,
          user.role,
        );
      } catch (mailError) {
        console.error('Failed to send verification success email:', mailError);
      }
    }

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

  async requestVerification(userId: number, verifierId: number) {
    const requester = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!requester) {
      throw new BadRequestException('Requester user not found');
    }

    const verifier = await this.prisma.user.findUnique({
      where: { id: verifierId },
    });
    if (!verifier) {
      throw new BadRequestException('Verifier user not found');
    }

    // Role hierarchy checks
    if (requester.role === Role.ARTIA) {
      if (verifier.role !== Role.SADAR) {
        throw new BadRequestException(
          'Artia can only request verification from a Sadar',
        );
      }
    } else if (requester.role === Role.FARMER) {
      if (verifier.role !== Role.ARTIA) {
        throw new BadRequestException(
          'Farmer can only request verification from an Artia',
        );
      }
    } else if (requester.role === Role.SADAR) {
      if (verifier.role !== Role.SUPER_ADMIN) {
        throw new BadRequestException(
          'Sadar can only request verification from Super Admin',
        );
      }
    } else {
      throw new BadRequestException(
        'This role does not require verification request',
      );
    }

    // Check that we have the required fields
    if (requester.role === Role.FARMER) {
      if (
        !requester.name ||
        !requester.email ||
        !requester.address ||
        !requester.cnic
      ) {
        throw new BadRequestException(
          'Farmer requires Name, Email, Address, and CNIC for verification',
        );
      }
    } else {
      if (
        !requester.name ||
        !requester.email ||
        !requester.phone ||
        !requester.cnic ||
        !requester.address ||
        !requester.city ||
        !requester.profileImage
      ) {
        throw new BadRequestException(
          'Sadar/Artia must provide Name, Email, Phone, CNIC, Address, City, and Profile Image for verification',
        );
      }
    }

    const payload = {
      userId: requester.id,
      verifierId: verifier.id,
      type: 'confirm-verification',
    };
    const token = this.jwtService.sign(payload, { expiresIn: '7d' });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const verifyUrl = `${frontendUrl}/verify-user?token=${token}`;

    if (!verifier.email) {
      throw new BadRequestException('Verifier has no registered email address');
    }

    try {
      await this.mailService.sendVerificationRequestMail(
        verifier.email,
        requester,
        verifyUrl,
      );
    } catch (mailError) {
      console.error('Failed to send verification request email:', mailError);
    }

    return {
      message: 'Verification request sent successfully to ' + verifier.name,
    };
  }

  async confirmVerification(token: string, activeUserId?: number) {
    let payload: any;
    try {
      payload = this.jwtService.verify(token);
    } catch (e) {
      throw new BadRequestException('Invalid or expired verification token');
    }

    if (payload.type !== 'confirm-verification') {
      throw new BadRequestException('Invalid token type');
    }

    const { userId, verifierId } = payload;

    if (activeUserId && activeUserId !== verifierId) {
      const activeUser = await this.prisma.user.findUnique({ where: { id: activeUserId } });
      if (!activeUser || (activeUser.role !== Role.SUPER_ADMIN && activeUserId !== verifierId)) {
        throw new BadRequestException('You are not authorized to verify this request.');
      }
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User to be verified not found');
    }

    const verifier = await this.prisma.user.findUnique({ where: { id: verifierId } });
    if (!verifier) {
      throw new NotFoundException('Verifier user not found');
    }

    if (verifier.role !== Role.SUPER_ADMIN) {
      if (user.role === Role.FARMER && verifier.role !== Role.ARTIA) {
        throw new BadRequestException('Farmers can only be verified by an Artia.');
      }
      if (user.role === Role.ARTIA && verifier.role !== Role.SADAR) {
        throw new BadRequestException('Artias can only be verified by a Sadar.');
      }
    }

    if (user.status === UserStatus.VERIFIED) {
      return { message: 'User is already verified' };
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        status: UserStatus.VERIFIED,
        verifiedBy: verifierId,
        verifiedAt: new Date(),
      },
    });

    // If an Artia was just verified, invalidate the public Artia directory cache
    if (user.role === Role.ARTIA) {
      await this.redisService.del('artia:list:public');
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const loginUrl = frontendUrl.endsWith('/') ? `${frontendUrl}login` : `${frontendUrl}/login`;

    if (user.email) {
      try {
        await this.mailService.sendVerificationSuccessMail(
          user.email,
          loginUrl,
          user.role,
        );
      } catch (mailError) {
        console.error('Failed to send verification success email:', mailError);
      }
    }

    return {
      message: `${user.name} has been verified successfully. An email has been sent to them with their login credentials.`,
    };
  }

  async sendVerificationSuccessEmail(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.status !== UserStatus.VERIFIED) {
      throw new BadRequestException('User is not verified yet');
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const loginUrl = frontendUrl.endsWith('/') ? `${frontendUrl}login` : `${frontendUrl}/login`;

    if (user.email) {
      try {
        await this.mailService.sendVerificationSuccessMail(
          user.email,
          loginUrl,
          user.role,
        );
      } catch (mailError) {
        console.error('Failed to send verification success email:', mailError);
      }
    }
    return { message: 'Verification success email sent to ' + user.email };
  }

  async findOrCreateSuperAdmin(email: string, name: string) {
    let user = await this.findByEmail(email);
    if (!user) {
      const plainPassword = process.env.SUPER_ADMIN_PASSWORD?.replace(/^"|"$/g, '') || '';
      const hashedPassword = await bcrypt.hash(plainPassword, 10);
      user = await this.prisma.user.create({
        data: {
          email,
          name,
          password: hashedPassword,
          role: Role.SUPER_ADMIN,
          status: UserStatus.VERIFIED,
          isOtpVerified: true,
        },
      });
    }
    return user;
  }

  async createSadar(createUserDto: CreateUserDto, creator?: { id: number; role: Role }) {
    // Mandi is required for Sadar
    if (!createUserDto.mandiId) {
      throw new BadRequestException('mandiId is required. A Sadar must belong to a Mandi.');
    }

    // Verify Mandi exists in the database
    const mandi = await this.prisma.mandi.findUnique({
      where: { id: createUserDto.mandiId },
    });
    if (!mandi) {
      throw new BadRequestException('The specified Mandi does not exist.');
    }

    // Validate Sadar address matches Mandi name and city matches Mandi city
    const isCityMatch = createUserDto.city && mandi.city &&
      createUserDto.city.trim().toLowerCase() === mandi.city.trim().toLowerCase();

    const isAddressMatch = createUserDto.address && mandi.name &&
      createUserDto.address.trim().toLowerCase() === mandi.name.trim().toLowerCase();

    if (!isCityMatch || !isAddressMatch) {
      throw new BadRequestException('Address or city are not correct');
    }

    if (createUserDto.phone) {
      const existing = await this.findByPhone(createUserDto.phone);
      if (existing) throw new BadRequestException('Phone already exists');
    }
    if (createUserDto.email) {
      const existing = await this.findByEmail(createUserDto.email);
      if (existing) throw new BadRequestException('Email already exists');
    }

    if (creator && creator.role === Role.SUPER_ADMIN) {
      // Created by SUPER_ADMIN => Auto verified
      const plainPassword = createUserDto.password;
      const hashedPassword = await bcrypt.hash(plainPassword, 10);
      
      const user = await this.prisma.user.create({
        data: {
          name: createUserDto.name,
          password: hashedPassword,
          phone: createUserDto.phone,
          email: createUserDto.email,
          cnic: createUserDto.cnic,
          role: Role.SADAR,
          status: UserStatus.VERIFIED,
          profileImage: createUserDto.profileImage,
          address: createUserDto.address,
          city: createUserDto.city,
          mandiId: createUserDto.mandiId,
          createdBy: creator.id,
          verifiedBy: creator.id,
          verifiedAt: new Date(),
        },
      });
      const { password, ...result } = user;
      return result;
    } else {
      // Self registration as SADAR => Status PENDING, triggers email request to Super Admin
      const plainPassword = createUserDto.password;
      const hashedPassword = await bcrypt.hash(plainPassword, 10);
      
      const user = await this.prisma.user.create({
        data: {
          name: createUserDto.name,
          password: hashedPassword,
          phone: createUserDto.phone,
          email: createUserDto.email,
          cnic: createUserDto.cnic,
          role: Role.SADAR,
          status: UserStatus.PENDING,
          profileImage: createUserDto.profileImage,
          address: createUserDto.address,
          city: createUserDto.city,
          mandiId: createUserDto.mandiId,
          createdBy: null,
          verifiedBy: null,
          verifiedAt: null,
        },
      });

      // Find the SUPER_ADMIN user
      const superAdminEmail = process.env.SUPER_ADMIN_EMAIL || '';
      const superAdmin = await this.prisma.user.findFirst({
        where: { role: Role.SUPER_ADMIN },
      });
      
      const verifierId = superAdmin ? superAdmin.id : 1;

      // Generate confirmation token (JWT payload with verifier verification type)
      const payload = {
        userId: user.id,
        verifierId: verifierId,
        type: 'confirm-verification',
      };
      const token = this.jwtService.sign(payload, { expiresIn: '7d' });

      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const verifyUrl = `${frontendUrl}/verify-user?token=${token}`;

      try {
        await this.mailService.sendVerificationRequestMail(superAdminEmail, user, verifyUrl);
      } catch (mailError) {
        console.error('Failed to send verification request email to super admin:', mailError);
      }

      const { password, ...result } = user;
      return {
        ...result,
        message: 'Registration successful. A verification request email has been sent to Super Admin.',
      };
    }
  }

  async getSadarArtias(sadarId: number) {
    const sadar = await this.prisma.user.findUnique({
      where: { id: sadarId },
    });

    if (!sadar || !sadar.mandiId) {
      return { count: 0, artias: [] };
    }

    // Self-healing query: link any null mandiId Artias created by this Sadar to this Mandi
    await this.prisma.user.updateMany({
      where: {
        role: Role.ARTIA,
        createdBy: sadarId,
        mandiId: null,
      },
      data: {
        mandiId: sadar.mandiId,
      },
    });

    const artias = await this.prisma.user.findMany({
      where: {
        role: Role.ARTIA,
        mandiId: sadar.mandiId,
      },
      include: {
        mandi: true,
      },
    });

    return {
      count: artias.length,
      artias: artias.map(artia => {
        const { password, ...safeArtia } = artia;
        return safeArtia;
      }),
    };
  }

  async getArtiaFarmers(artiaId: number) {
    const profiles = await this.prisma.farmerProfile.findMany({
      where: {
        connections: {
          some: { artiaId },
        },
      },
      include: {
        user: true,
        mandi: true,
        connections: {
          where: { artiaId },
        },
      },
    });

    return {
      count: profiles.length,
      farmers: profiles.map(profile => {
        const connectionPhone = profile.connections?.[0]?.phone;
        if (profile.user) {
          const { password, ...safeUser } = profile.user;
          if (connectionPhone) {
            safeUser.phone = connectionPhone;
          }
          return { ...profile, user: safeUser };
        }
        return profile;
      }),
    };
  }

  async getFarmerArtia(farmerId: number) {
    const profile = await this.prisma.farmerProfile.findUnique({
      where: {
        userId: farmerId,
      },
      include: {
        artia: {
          include: {
            mandi: true,
          }
        },
        mandi: true,
      },
    });

    if (!profile) {
      throw new NotFoundException('Farmer profile not found');
    }

    let safeArtia = null;
    if (profile.artia) {
      const { password, ...artiaData } = profile.artia;
      safeArtia = artiaData;
    }

    return {
      artia: safeArtia,
      mandi: profile.mandi,
    };
  }

  async getRecentActivity(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const posts = await this.prisma.post.findMany({
      where: { authorId: userId },
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { comments: true } }
      }
    });

    const comments = await this.prisma.comment.findMany({
      where: { authorId: userId },
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: {
        post: {
          select: {
            id: true,
            title_en: true,
            title_ur: true,
          }
        }
      }
    });

    const prices = await this.prisma.price.findMany({
      where: { userId },
      take: 5,
      orderBy: { createdAt: 'desc' },
    });

    const activities = [
      ...posts.map(post => ({
        id: post.id,
        type: 'POST',
        title: post.title_en || post.title_ur || 'Untitled Post',
        createdAt: post.createdAt,
        metadata: {
          title_en: post.title_en,
          title_ur: post.title_ur,
          commentCount: post._count.comments
        }
      })),
      ...comments.map(comment => ({
        id: comment.id,
        type: 'COMMENT',
        title: `Commented on: ${comment.post?.title_en || comment.post?.title_ur || 'Untitled Post'}`,
        createdAt: comment.createdAt,
        metadata: {
          postId: comment.postId,
          content: comment.content
        }
      })),
      ...prices.map(price => ({
        id: price.id,
        type: 'PRICE_UPDATE',
        title: `Price update: PKR ${price.price}`,
        createdAt: price.createdAt,
        metadata: {
          price: price.price,
          unit: price.unit,
          cropId: price.cropId,
          mandiId: price.mandiId
        }
      }))
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
     .slice(0, 4);

    return activities;
  }

  async getIndependentFarmers(search?: string) {
    const whereClause: any = {
      role: Role.FARMER,
      status: UserStatus.VERIFIED,
      farmerProfile: {
        // A farmer is independent only when they have no active join-table
        // connection. This excludes farmers who left an Artia but still have
        // legacy profile fields from an older relationship.
        connections: { none: {} },
      },
    };

    if (search) {
      whereClause.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.user.findMany({
      where: whereClause,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        city: true,
        address: true,
      },
    });
  }

  async createConnectionRequest(artiaId: number, farmerId: number) {
    const farmer = await this.prisma.user.findUnique({
      where: { id: farmerId },
      include: { farmerProfile: true },
    });

    if (!farmer || farmer.role !== Role.FARMER) {
      throw new BadRequestException('User is not a farmer.');
    }

    if (farmer.status !== UserStatus.VERIFIED) {
      throw new BadRequestException('Farmer is not verified.');
    }

    if (!farmer.farmerProfile) {
      throw new BadRequestException('Farmer profile not found.');
    }

    const limitResult = await this.bypassService.checkFarmerJoinLimits(
      farmer.farmerProfile.id,
      artiaId,
      farmer.cnic || '',
    );

    if (!limitResult.allowed) {
      throw new BadRequestException({
        error: 'LIMIT_HIT',
        reason: limitResult.reason,
      });
    }

    return this.prisma.connectionRequest.upsert({
      where: {
        artiaId_farmerId: {
          artiaId,
          farmerId,
        },
      },
      update: {
        status: 'PENDING',
      },
      create: {
        artiaId,
        farmerId,
        status: 'PENDING',
      },
    });
  }

  async getConnectionRequests(userId: number, role: Role) {
    if (role === Role.FARMER) {
      const reqs = await this.prisma.connectionRequest.findMany({
        where: {
          farmerId: userId,
          status: 'PENDING',
        },
        orderBy: { createdAt: 'desc' },
      });

      // Get Artia details
      const artiaIds = reqs.map((r: any) => r.artiaId);
      const artias = await this.prisma.user.findMany({
        where: { id: { in: artiaIds } },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          mandi: {
            select: {
              name: true,
              city: true,
            },
          },
        },
      });

      return reqs.map((r: any) => {
        const artia = artias.find((a) => a.id === r.artiaId);
        return {
          ...r,
          artia,
        };
      });
    } else {
      const reqs = await this.prisma.connectionRequest.findMany({
        where: {
          artiaId: userId,
        },
        orderBy: { createdAt: 'desc' },
      });

      // Get Farmer details
      const farmerIds = reqs.map((r: any) => r.farmerId);
      const farmers = await this.prisma.user.findMany({
        where: { id: { in: farmerIds } },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
        },
      });

      return reqs.map((r: any) => {
        const farmer = farmers.find((f) => f.id === r.farmerId);
        return {
          ...r,
          farmer,
        };
      });
    }
  }

  async acceptConnectionRequest(requestId: number, farmerId: number) {
    const request = await this.prisma.connectionRequest.findUnique({
      where: { id: requestId },
    });

    if (!request || request.farmerId !== farmerId || request.status !== 'PENDING') {
      throw new BadRequestException('Invalid connection request.');
    }

    const artia = await this.prisma.user.findUnique({
      where: { id: request.artiaId },
    });

    if (!artia) {
      throw new BadRequestException('Artia not found.');
    }

    const farmer = await this.prisma.user.findUnique({
      where: { id: farmerId },
      include: { farmerProfile: true },
    });

    if (!farmer || !farmer.farmerProfile) {
      throw new BadRequestException('Farmer profile not found.');
    }

    // Check limits
    const limitResult = await this.bypassService.checkFarmerJoinLimits(
      farmer.farmerProfile.id,
      request.artiaId,
      farmer.cnic || '',
    );

    if (!limitResult.allowed) {
      throw new BadRequestException({
        error: 'LIMIT_HIT',
        reason: limitResult.reason,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Accept request
      await tx.connectionRequest.update({
        where: { id: requestId },
        data: { status: 'ACCEPTED' },
      });

      // 2. Establish connection
      await (tx as any).farmerArtiaConnection.create({
        data: {
          farmerId: farmer.farmerProfile!.id,
          artiaId: request.artiaId,
          phone: farmer.phone,
        },
      });

      // 3. Update mandiId on profile if not set
      if (!farmer.farmerProfile!.mandiId) {
        await (tx as any).farmerProfile.update({
          where: { id: farmer.farmerProfile!.id },
          data: { mandiId: artia.mandiId },
        });
      }

      // 4. Update mandiId on base User model if not set
      if (!farmer.mandiId) {
        await (tx as any).user.update({
          where: { id: farmerId },
          data: { mandiId: artia.mandiId },
        });
      }

      return { success: true };
    });
  }

  async rejectConnectionRequest(requestId: number, farmerId: number) {
    const request = await this.prisma.connectionRequest.findUnique({
      where: { id: requestId },
    });

    if (!request || request.farmerId !== farmerId || request.status !== 'PENDING') {
      throw new BadRequestException('Invalid connection request.');
    }

    await this.prisma.connectionRequest.update({
      where: { id: requestId },
      data: { status: 'REJECTED' },
    });

    return { success: true };
  }

  async getArtiaProfile(artiaId: number) {
    let profile = await this.prisma.artiaProfile.findUnique({
      where: { userId: artiaId },
    });
    if (!profile) {
      profile = await this.prisma.artiaProfile.create({
        data: { userId: artiaId },
      });
    }
    return profile;
  }

  async updateArtiaProfile(artiaId: number, dto: UpdateArtiaProfileDto) {
    const updatedProfile = await this.prisma.artiaProfile.update({
      where: { userId: artiaId },
      data: dto,
    });

    // Invalidate Artia profile + directory caches so next request gets fresh data
    await Promise.all([
      this.redisService.del(`artia:profile:${artiaId}`),
      this.redisService.del('artia:list:public'),
    ]);

    // 1. Send profile update email to Super Admin
    const artiaUser = await this.prisma.user.findUnique({
      where: { id: artiaId },
    });

    const superAdmin = await this.prisma.user.findFirst({
      where: { role: Role.SUPER_ADMIN },
    });

    if (superAdmin && superAdmin.email && artiaUser) {
      await this.mailService.sendArtiaProfileUpdateMail(
        superAdmin.email,
        artiaUser.name,
        updatedProfile,
      ).catch((e) => console.error('Failed to send Artia update email to Super Admin:', e));
    }

    // 2. Dispatch permission request notifications to connected farmers whenever stats display is on
    if (updatedProfile.showFarmerCount || updatedProfile.showFarmerDetails) {
      // Find all farmers attached to this Artia
      const farmers = await this.prisma.farmerProfile.findMany({
        where: { artiaId },
        include: { user: true },
      });

      for (const farmer of farmers) {
        // Create consent request notification if not already existing and unread
        const existing = await this.prisma.notification.findFirst({
          where: {
            userId: farmer.user.id,
            type: 'CONSENT_REQUEST',
            read: false,
          },
        });

        if (!existing) {
          await this.prisma.notification.create({
            data: {
              userId: farmer.user.id,
              type: 'CONSENT_REQUEST',
              title_en: 'Privacy Consent Request from your Artia',
              title_ur: 'آڑھتی کی طرف سے پرائیویسی کی اجازت کی درخواست',
              body_en: `Your Artia (${updatedProfile.shopName || 'attached Artia'}) wants to display connected farmer stats on their public profile. Do you want to allow this?`,
              body_ur: `آپ کا آڑھتی (${updatedProfile.shopName || 'منسلک آڑھتی'}) اپنی پبلک پروفائل پر کسانوں کے اعداد و شمار ظاہر کرنا چاہتا ہے۔ کیا آپ اس کی اجازت دینا چاہتے ہیں؟`,
              metadata: JSON.stringify({
                artiaId,
                shopName: updatedProfile.shopName || 'Your Artia',
              }),
            },
          });
        }
      }
    }

    return updatedProfile;
  }

  async updateFarmerPrivacy(farmerUserId: number, dto: UpdateFarmerPrivacyDto) {
    const profile = await this.prisma.farmerProfile.findUnique({
      where: { userId: farmerUserId },
    });

    if (!profile) {
      throw new NotFoundException('Farmer profile not found');
    }

    // If the farmer is turning off their public profile, cascade:
    // force shareInCount and showOnArtiaProfile to false as well,
    // because a farmer who hides themselves publicly should not appear
    // in any Artia count or detail listing either.
    const turningOffPublic = dto.showOwnDetailsPublicly === false;

    const updated = await this.prisma.farmerProfile.update({
      where: { userId: farmerUserId },
      data: {
        shareInCount:         turningOffPublic ? false : (dto.shareInCount         !== undefined ? dto.shareInCount         : undefined),
        showOnArtiaProfile:   turningOffPublic ? false : (dto.showOnArtiaProfile   !== undefined ? dto.showOnArtiaProfile   : undefined),
        showOwnDetailsPublicly: dto.showOwnDetailsPublicly !== undefined ? dto.showOwnDetailsPublicly : undefined,
      },
    });

    // Invalidate the connected Artia's public profile cache so changes are reflected immediately
    if (profile.artiaId) {
      await this.redisService.del(`artia:profile:${profile.artiaId}`);
    }

    return updated;
  }

  async getFarmerProfile(farmerId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: farmerId },
      include: { farmerProfile: true },
    });
    if (!user) {
      throw new NotFoundException('Farmer not found');
    }
    // Ensure farmerProfile exists
    if (!user.farmerProfile) {
      const profile = await this.prisma.farmerProfile.create({
        data: { userId: farmerId },
      });
      user.farmerProfile = profile;
    }
    return user;
  }

  async updateFarmerProfile(farmerId: number, dto: UpdateFarmerProfileDto) {
    const {
      name,
      email,
      phone,
      cnic,
      address,
      city,
      landSize,
      mandiId,
      showOnArtiaProfile,
      shareInCount,
      showOwnDetailsPublicly,
    } = dto;

    // Check unique constraints on phone, cnic, email
    if (phone) {
      const existing = await this.prisma.user.findFirst({
        where: { phone, NOT: { id: farmerId } },
      });
      if (existing) {
        throw new BadRequestException('This phone number is already registered under another account.');
      }
    }
    if (email) {
      const existing = await this.prisma.user.findFirst({
        where: { email, NOT: { id: farmerId } },
      });
      if (existing) {
        throw new BadRequestException('This email is already registered under another account.');
      }
    }
    if (cnic) {
      const existing = await this.prisma.user.findFirst({
        where: { cnic, NOT: { id: farmerId } },
      });
      if (existing) {
        throw new BadRequestException('This CNIC is already registered under another account.');
      }
    }

    // Update user
    await this.prisma.user.update({
      where: { id: farmerId },
      data: {
        ...(name !== undefined && { name }),
        ...(email !== undefined && { email }),
        ...(phone !== undefined && { phone }),
        ...(cnic !== undefined && { cnic }),
        ...(address !== undefined && { address }),
        ...(city !== undefined && { city }),
      },
    });

    // Update farmer profile
    const updatedProfile = await this.prisma.farmerProfile.update({
      where: { userId: farmerId },
      data: {
        ...(landSize !== undefined && { landSize }),
        ...(mandiId !== undefined && { mandiId }),
        ...(showOnArtiaProfile !== undefined && { showOnArtiaProfile }),
        ...(shareInCount !== undefined && { shareInCount }),
        ...(showOwnDetailsPublicly !== undefined && { showOwnDetailsPublicly }),
      },
    });

    return {
      message: 'Profile updated successfully',
      profile: updatedProfile,
    };
  }

  async getNotifications(userId: number) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async markNotificationRead(userId: number, id: number) {
    return this.prisma.notification.update({
      where: { id, userId },
      data: { read: true },
    });
  }

  async respondToConsent(userId: number, notificationId: number, dto: { shareInCount: boolean; showOnArtiaProfile: boolean }) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification || notification.userId !== userId) {
      throw new NotFoundException('Notification not found');
    }

    // Fetch the farmer profile to get the connected artiaId for cache invalidation
    const farmerProfile = await this.prisma.farmerProfile.findUnique({
      where: { userId },
      select: { artiaId: true },
    });

    // Update privacy preferences on farmer profile
    await this.prisma.farmerProfile.update({
      where: { userId },
      data: {
        shareInCount: dto.shareInCount,
        showOnArtiaProfile: dto.showOnArtiaProfile,
      },
    });

    // Delete the consent request notification once responded
    await this.prisma.notification.delete({
      where: { id: notificationId },
    });

    // Invalidate the Artia's public profile cache so the change is reflected immediately
    if (farmerProfile?.artiaId) {
      await this.redisService.del(`artia:profile:${farmerProfile.artiaId}`);
    }

    return { success: true };
  }

  async getPublicArtiaProfile(artiaId: number) {
    const cacheKey = `artia:profile:${artiaId}`;

    // Cache-aside: return cached data if available
    const cached = await this.redisService.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const artia = await this.prisma.user.findFirst({
      where: { id: artiaId, role: Role.ARTIA },
      select: {
        id: true,
        name: true,
        phone: true,
        city: true,
        address: true,
        mandi: { select: { id: true, name: true, city: true } },
      },
    });

    if (!artia) {
      throw new NotFoundException('Artia profile not found');
    }

    const profile = await this.getArtiaProfile(artiaId);

    // Get count of farmers who consented AND have not hidden their own public profile
    const farmerCount = await this.prisma.farmerProfile.count({
      where: { artiaId, shareInCount: true, showOwnDetailsPublicly: true },
    });

    // Get details of farmers who consented AND have not hidden their own public profile
    let farmerDetails: any[] = [];
    if (profile.showFarmerDetails) {
      const consented = await this.prisma.farmerProfile.findMany({
        where: { artiaId, showOnArtiaProfile: true, showOwnDetailsPublicly: true },
        select: {
          id: true,
          user: {
            select: {
              id: true,
              name: true,
              city: true,
              address: true,
              profileImage: true,
            },
          },
        },
      });
      farmerDetails = consented.map((c) => c.user);
    }

    const result = {
      artia,
      profile,
      farmerCount: profile.showFarmerCount ? farmerCount : null,
      farmerDetails,
    };

    // Store in Redis for 24 hours (ARTIA_PROFILE_TTL)
    await this.redisService.set(cacheKey, JSON.stringify(result), ARTIA_PROFILE_TTL);

    return result;
  }

  async getPublicFarmerProfile(farmerUserId: number, requesterRole?: Role) {
    const farmer = await this.prisma.user.findFirst({
      where: { id: farmerUserId, role: Role.FARMER },
      select: {
        id: true,
        name: true,
        city: true,
        address: true,
        mandi: { select: { id: true, name: true } },
        farmerProfile: {
          select: {
            landSize: true,
            showOwnDetailsPublicly: true,
            artia: {
              select: {
                id: true,
                name: true,
                artiaProfile: { select: { shopName: true } },
              },
            },
          },
        },
      },
    });

    if (!farmer) {
      throw new NotFoundException('Farmer profile not found');
    }

    const isPublic = farmer.farmerProfile?.showOwnDetailsPublicly;
    const isSuperAdmin = requesterRole === Role.SUPER_ADMIN;

    if (!isPublic && !isSuperAdmin) {
      throw new BadRequestException('This profile is private.');
    }

    return farmer;
  }

  async getPublicArtiaList() {
    const cacheKey = 'artia:list:public';

    // Cache-aside: return cached list if available
    const cached = await this.redisService.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const result = await this.prisma.user.findMany({
      where: {
        role: Role.ARTIA,
        status: UserStatus.VERIFIED,
      },
      select: {
        id: true,
        name: true,
        city: true,
        address: true,
        mandi: {
          select: {
            id: true,
            name: true,
            city: true,
          },
        },
        artiaProfile: {
          select: {
            shopName: true,
            shopPhone: true,
            address: true,
            commissionRules: true,
          },
        },
      },
    });

    // Store in Redis for 30 hours (ARTIA_LIST_TTL)
    await this.redisService.set(cacheKey, JSON.stringify(result), ARTIA_LIST_TTL);

    return result;
  }
}
