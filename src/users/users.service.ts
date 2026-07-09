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

    // If an upper role is creating this user, they are automatically verified by that creator.
    // If not (e.g. self-registration in the future), they default to PENDING.
    const isCreatedByUpperRole = !!creatorId;
    const finalStatus = isCreatedByUpperRole ? UserStatus.VERIFIED : (createUserDto.status || UserStatus.PENDING);
    const verifiedBy = isCreatedByUpperRole ? creatorId : null;
    const verifiedAt = isCreatedByUpperRole ? new Date() : null;

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
        mandiId: createUserDto.mandiId,
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
      if (verifier.role !== Role.ARTIA && verifier.role !== Role.SADAR) {
        throw new BadRequestException(
          'Farmer can only request verification from an Artia or Sadar',
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
    const artias = await this.prisma.user.findMany({
      where: {
        role: Role.ARTIA,
        createdBy: sadarId,
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
}
