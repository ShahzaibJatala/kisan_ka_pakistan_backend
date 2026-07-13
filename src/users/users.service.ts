import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import * as bcrypt from 'bcrypt';
import { Role, UserStatus } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { MailService } from '../mail/mail.service';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private mailService: MailService,
  ) {}

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
      if (creatorRole !== Role.ARTIA) {
        throw new BadRequestException(
          'Only an ARTIA can create a FARMER account.',
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
        cnic: createUserDto.cnic,
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

    // --- FIX: Create FarmerProfile for Farmers ---
    if (targetRole === Role.FARMER) {
      const artiaId = creatorRole === Role.ARTIA ? creatorId : null;
      await this.prisma.farmerProfile.create({
        data: {
          userId: user.id,
          artiaId: artiaId,
          mandiId: createUserDto.mandiId || null,
        }
      });
    }

    const { password, ...result } = user;

    // If verified by upper role, send them the success email with the dashboard login link
    if (isCreatedByUpperRole && user.email) {
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const loginUrl = frontendUrl.endsWith('/') ? `${frontendUrl}login` : `${frontendUrl}/login`;
      
      await this.mailService.sendVerificationSuccessMail(
        user.email,
        loginUrl,
        user.role,
      );
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

    const verifyUrl = `${process.env.BACKEND_URL}/users/confirm-verification?token=${token}`;

    if (!verifier.email) {
      throw new BadRequestException('Verifier has no registered email address');
    }

    await this.mailService.sendVerificationRequestMail(
      verifier.email,
      requester,
      verifyUrl,
    );

    return {
      message: 'Verification request sent successfully to ' + verifier.name,
    };
  }

  async confirmVerification(token: string) {
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

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const loginUrl = frontendUrl.endsWith('/') ? `${frontendUrl}login` : `${frontendUrl}/login`;

    if (user.email) {
      await this.mailService.sendVerificationSuccessMail(
        user.email,
        loginUrl,
        user.role,
      );
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
      await this.mailService.sendVerificationSuccessMail(
        user.email,
        loginUrl,
        user.role,
      );
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

      // Verify URL
      const verifyUrl = `${process.env.BACKEND_URL}/users/confirm-verification?token=${token}`;

      await this.mailService.sendVerificationRequestMail(superAdminEmail, user, verifyUrl);

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
        artiaId: artiaId,
      },
      include: {
        user: true,
        mandi: true,
      },
    });

    return {
      count: profiles.length,
      farmers: profiles.map(profile => {
        if (profile.user) {
          const { password, ...safeUser } = profile.user;
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
        artiaId: null,
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

    if (farmer.farmerProfile?.artiaId) {
      throw new BadRequestException('Farmer is already connected to an Artia.');
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

    return this.prisma.$transaction(async (tx) => {
      // 1. Accept request
      await tx.connectionRequest.update({
        where: { id: requestId },
        data: { status: 'ACCEPTED' },
      });

      // 2. Reject other requests for this farmer
      await tx.connectionRequest.updateMany({
        where: {
          farmerId,
          status: 'PENDING',
        },
        data: { status: 'REJECTED' },
      });

      // 3. Connect farmer to Artia's profile & Mandi
      await tx.farmerProfile.update({
        where: { userId: farmerId },
        data: {
          artiaId: request.artiaId,
          mandiId: artia.mandiId,
        },
      });

      // 4. Update mandiId on base User model
      await tx.user.update({
        where: { id: farmerId },
        data: {
          mandiId: artia.mandiId,
        },
      });

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
}
