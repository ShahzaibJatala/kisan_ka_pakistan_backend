import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { LoginDto } from './dto/login.dto';
import {
  ResetPasswordDto,
  SendOtpDto,
  VerifyOtpDto,
} from './dto/reset-password.dto';
import { MailService } from 'src/mail/mail.service';
import {
  SuperAdminLoginDto,
  SuperAdminVerifyOtpDto,
} from './dto/super-admin.dto';
import { PrismaService } from '../prisma/prisma.service';
import { Role, UserStatus } from '@prisma/client';

@Injectable()
export class AuthService {
    private superAdminOtp: { userId: number; otp: string; expires: number } | null = null;

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private mailService: MailService,
    private prisma: PrismaService,
  ) {}

  async validateUser(loginDto: LoginDto): Promise<any> {
    if (!loginDto.phone && !loginDto.email) {
      throw new BadRequestException(
        'Either phone or email must be provided for login.',
      );
    }

    const user = loginDto.phone
      ? await this.usersService.findByPhone(loginDto.phone)
      : await this.usersService.findByEmail(loginDto.email!);

    if (user && (await bcrypt.compare(loginDto.password, user.password))) {
      const { password, ...result } = user;
      return result;
    }
    throw new UnauthorizedException('The email or password you entered is incorrect.');
  }

  async login(user: any) {
    const { accessToken, refreshToken } = await this.generateTokens(user);
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        phone: user.phone,
        email: user.email,
        status: user.status,
      },
    };
  }

  // 1. Send OTP
  async sendOTP(dto: SendOtpDto) {
    const { email } = dto;
    const user = await this.usersService.findByEmail(email);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    await this.mailService.sendOtpMail(email, otp);

    // Persist the reset code only after the mail queue accepts the delivery job.
    await this.usersService.update(user.id, {
      resetOtp: otp,
      otpExpires: expires,
      isOtpVerified: false,
    });

    return { message: 'OTP sent successfully' };
  }

  // 2. Verify OTP
  async verifyOTP(dto: VerifyOtpDto) {
    const { email, otp } = dto;
    const user = await this.usersService.findByEmail(email);

    if (
      !user ||
      user.resetOtp !== otp ||
      !user.otpExpires ||
      user.otpExpires < new Date()
    ) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    await this.usersService.update(user.id, {
      isOtpVerified: true,
      resetOtp: null,
      otpExpires: null,
    });

    return { message: 'OTP verified successfully' };
  }

  // 3. Reset Password
  async resetPassword(dto: ResetPasswordDto) {
    const { email, password } = dto;
    const user = await this.usersService.findByEmail(email);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.isOtpVerified) {
      throw new BadRequestException('OTP verification required');
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    await this.usersService.update(user.id, {
      password: hashedPassword,
      isOtpVerified: false,
    });

    return { message: 'Password reset successfully' };
  }

  /**
   * Generate both tokens.
   * - Access token: full payload (sub, name, email, phone, role) — short-lived 15m
   * - Refresh token: ONLY userId (sub) — long-lived 7d, saved hashed in DB
   */
  async generateTokens(user: any) {
    const accessPayload = {
      sub: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status,
    };

    // Refresh token contains userId, role, status, and hasPhone boolean for middleware route authorization
    const refreshPayload = {
      sub: user.id,
      role: user.role,
      status: user.status,
      hasPhone: !!user.phone && user.phone.trim() !== '',
    };

    const accessToken = this.jwtService.sign(accessPayload, {
      expiresIn: '15m',
    });
    const refreshToken = this.jwtService.sign(refreshPayload, {
      expiresIn: '7d',
    });

    // Hash the refresh token before saving to DB (never store plain tokens)
    const hashedRefreshToken = await bcrypt.hash(refreshToken, 10);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: hashedRefreshToken },
    });

    return { accessToken, refreshToken };
  }

  async refreshAccessToken(user: any) {
    // Issue a new access token only (refresh token stays the same until logout)
    const accessPayload = {
      sub: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status,
    };
    const newAccessToken = this.jwtService.sign(accessPayload, {
      expiresIn: '15m',
    });

    return { access_token: newAccessToken };
  }

  /**
   * Logout: clear refresh token from DB
   */
  async logout(userId: number) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null },
    });
    return { message: 'Logged out successfully' };
  }

  async logoutAll(userId: number) {
    const salt = await bcrypt.genSalt(10);
    const invalidToken =
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15);
    const hashedToken = await bcrypt.hash(invalidToken, salt);

    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: hashedToken },
    });
    return { message: 'Logged out from all devices successfully' };
  }

  async verifyDashboardLoginToken(token: string) {
    let payload: any;
    try {
      payload = this.jwtService.verify(token);
    } catch (e) {
      throw new BadRequestException('Invalid or expired login token');
    }

    if (payload.type !== 'dashboard-login') {
      throw new BadRequestException('Invalid token type');
    }

    const user = await this.usersService.findById(payload.userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async superAdminLogin(dto: SuperAdminLoginDto) {
    const now = Date.now();
    const email = dto.email.trim().toLowerCase();
    const envEmail = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
    const envPass = process.env.SUPER_ADMIN_PASSWORD;

    let user = await this.prisma.user.findFirst({
      where: { email, role: Role.SUPER_ADMIN, status: UserStatus.VERIFIED },
    });

    // Keep the original environment account usable during the transition.
    const isEnvironmentLogin = email === envEmail && dto.password === envPass;
    if (!user && isEnvironmentLogin) {
      user = await this.usersService.findOrCreateSuperAdmin(email, 'Super Admin');
    }

    const passwordValid = user
      ? isEnvironmentLogin || await bcrypt.compare(dto.password, user.password)
      : false;
    if (!user || !passwordValid) {
      throw new UnauthorizedException('Invalid Super Admin credentials');
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    this.superAdminOtp = {
      userId: user.id,
      otp,
      expires: now + 5 * 60 * 1000,
    };

    await this.mailService.sendSuperAdminOtpMail(email, otp);

    return {
      message: 'Verification OTP sent to your registered Super Admin email.',
    };
  }

  async superAdminVerifyOtp(dto: SuperAdminVerifyOtpDto) {
    const now = Date.now();

    if (!this.superAdminOtp) {
      throw new BadRequestException(
        'No login attempt found. Please try logging in again.',
      );
    }

    if (now > this.superAdminOtp.expires) {
      this.superAdminOtp = null;
      throw new BadRequestException('OTP has expired. Please log in again.');
    }

    if (dto.otp !== this.superAdminOtp.otp) {
      throw new BadRequestException('Invalid OTP. Please try again.');
    }

    const loginAttempt = this.superAdminOtp;
    this.superAdminOtp = null;

    const user = await this.prisma.user.findFirst({
      where: {
        id: loginAttempt.userId,
        role: Role.SUPER_ADMIN,
        status: UserStatus.VERIFIED,
      },
    });
    if (!user) throw new UnauthorizedException('Super Admin account is no longer active.');

    const { accessToken, refreshToken } = await this.generateTokens(user);

    return {
      message: 'Logged in successfully',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      accessToken,
      refreshToken,
    };
  }

  async googleLogin(idToken: string, phone?: string) {
    if (!idToken) {
      throw new BadRequestException('ID token is required.');
    }

    let payload: any;
    try {
      const response = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`,
      );
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new BadRequestException(
          errData.error_description || 'Invalid Google ID token.',
        );
      }
      payload = await response.json();
    } catch (e) {
      if (e instanceof BadRequestException) {
        throw e;
      }
      throw new BadRequestException('Failed to verify Google ID token.');
    }

    const { email, name, picture } = payload;
    if (!email) {
      throw new BadRequestException('Google ID token missing email claim.');
    }

    // Find user by email
    let user = await this.usersService.findByEmail(email);

    if (!user) {
      // Register new user as FARMER by default, status PENDING (without phone number)
      const randomPassword = Math.random().toString(36).slice(-8);
      const hashedPassword = await bcrypt.hash(randomPassword, 10);

      user = await this.prisma.user.create({
        data: {
          email,
          name: name || 'Google User',
          password: hashedPassword,
          role: Role.FARMER,
          status: UserStatus.PENDING,
          profileImage: picture,
        },
      });

      // Create FarmerProfile
      await this.prisma.farmerProfile.create({
        data: {
          userId: user.id,
          artiaId: null,
          mandiId: null,
        },
      });

      // Send email alert to Super Admin ONLY on first registration
      try {
        const superAdminEmail =
          process.env.SUPER_ADMIN_EMAIL || 'kisankapakistan.info@gmail.com';
        let superAdmin = await this.prisma.user.findFirst({
          where: { role: Role.SUPER_ADMIN },
        });
        if (!superAdmin) {
          superAdmin = await this.usersService.findOrCreateSuperAdmin(
            superAdminEmail,
            'Super Admin',
          );
        }

        const token = this.jwtService.sign(
          {
            type: 'confirm-verification',
            userId: user.id,
            verifierId: superAdmin.id,
          },
          { expiresIn: '7d' },
        );
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        const verifyUrl = `${frontendUrl}/verify-user?token=${token}`;

        await this.mailService.sendGoogleSignupAlert(
          superAdminEmail,
          user,
          verifyUrl,
        );
      } catch (err) {
        console.error('Failed to send Super Admin alert:', err);
      }
    }

    const { accessToken, refreshToken } = await this.generateTokens(user);

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        phone: user.phone,
        email: user.email,
        status: user.status,
      },
    };
  }
}
