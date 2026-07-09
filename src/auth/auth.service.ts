import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
  HttpException,
  HttpStatus,
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

@Injectable()
export class AuthService {
  private lastSuperAdminAttemptTime = 0;
  private superAdminOtp: { otp: string; expires: number } | null = null;

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
    throw new UnauthorizedException('Invalid credentials');
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

    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    const expires = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    await this.usersService.update(user.id, {
      resetOtp: otp,
      otpExpires: expires,
      isOtpVerified: false,
    });

    await this.mailService.sendOtpMail(email, otp);

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
    };

    // Refresh token contains ONLY the userId for security
    const refreshPayload = { sub: user.id };

    const accessToken = this.jwtService.sign(accessPayload, { expiresIn: '15m' });
    const refreshToken = this.jwtService.sign(refreshPayload, { expiresIn: '7d' });

    // Hash the refresh token before saving to DB (never store plain tokens)
    const hashedRefreshToken = await bcrypt.hash(refreshToken, 10);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: hashedRefreshToken },
    });

    return { accessToken, refreshToken };
  }

  /**
   * Validate refresh token and return new access token.
   * Checks: valid JWT, userId exists in DB, token matches saved hash.
   */
  async refreshAccessToken(refreshToken: string) {
    let payload: any;
    try {
      payload = this.jwtService.verify(refreshToken);
    } catch (e) {
      throw new UnauthorizedException('Invalid or expired refresh token. Please login to your account.');
    }

    const userId = payload.sub;
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user || !user.refreshToken) {
      throw new UnauthorizedException('Session not found. Please login to your account.');
    }

    // Compare the incoming token with the hashed one stored in DB
    const tokenMatches = await bcrypt.compare(refreshToken, user.refreshToken);
    if (!tokenMatches) {
      throw new UnauthorizedException('Refresh token is invalid. Please login to your account.');
    }

    // Issue a new access token only (refresh token stays the same until logout)
    const accessPayload = {
      sub: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
    };
    const newAccessToken = this.jwtService.sign(accessPayload, { expiresIn: '15m' });

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
    const tenMinutes = 10 * 60 * 1000;

    if (now - this.lastSuperAdminAttemptTime < tenMinutes) {
      const remaining = Math.ceil(
        (tenMinutes - (now - this.lastSuperAdminAttemptTime)) / 1000 / 60,
      );
      throw new HttpException(
        `Rate limit exceeded. You can only request once every 10 minutes. Try again in ${remaining} minutes.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    this.lastSuperAdminAttemptTime = now;

    const envUser = process.env.SUPER_ADMIN_USER_NAME;
    const envEmail = process.env.SUPER_ADMIN_EMAIL;
    const envPass = process.env.SUPER_ADMIN_PASSWORD;

    if (
      dto.username !== envUser ||
      dto.email !== envEmail ||
      dto.password !== envPass
    ) {
      throw new UnauthorizedException('Invalid Super Admin credentials');
    }

    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    this.superAdminOtp = {
      otp,
      expires: now + 5 * 60 * 1000,
    };

    await this.mailService.sendSuperAdminOtpMail(dto.email, otp);

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

    this.superAdminOtp = null;

    const email = process.env.SUPER_ADMIN_EMAIL || '';
    const user = await this.usersService.findOrCreateSuperAdmin(
      email,
      'Super Admin',
    );

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
}
