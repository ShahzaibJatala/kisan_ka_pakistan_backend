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

    const user = await this.prisma.user.create({
      data: {
        name: createUserDto.name,
        password: hashedPassword,
        phone: createUserDto.phone,
        email: createUserDto.email,
        cnic: createUserDto.cnic,
        role: targetRole,
        status: createUserDto.status,
        profileImage: createUserDto.profileImage,
        address: createUserDto.address,
        city: createUserDto.city,
        mandiId: createUserDto.mandiId,
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

    return {
      message: `${user.name} has been verified successfully.`,
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

    const loginPayload = {
      userId: user.id,
      type: 'dashboard-login',
    };
    const loginToken = this.jwtService.sign(loginPayload, { expiresIn: '15m' });
    const dashboardLoginUrl = `${process.env.BACKEND_URL}/auth/dashboard-login?token=${loginToken}`;

    if (user.email) {
      await this.mailService.sendVerificationSuccessMail(
        user.email,
        dashboardLoginUrl,
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
}
