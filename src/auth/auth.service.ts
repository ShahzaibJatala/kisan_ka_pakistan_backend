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

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private mailService: MailService,
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
    // Include `name` in the JWT so the frontend can fully reconstruct
    // the user object from the token alone on page reload — no extra DB call.
    const payload = {
      sub: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
    };
    return {
      access_token: this.jwtService.sign(payload),
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

    // Generate 4 digit OTP (1000 - 9999)
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    const expires = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // 1. FIXED SYNTAX ERRORS:
    // You cannot just write "resetOtp = otp". You need to pass these
    // to your Prisma database so they actually save!

    // 2. SAVING TO DATABASE:
    // Assuming your usersService has an update method.
    // If it doesn't, you need to create one using prisma.user.update()
    await this.usersService.update(user.id, {
      resetOtp: otp,
      otpExpires: expires,
      isOtpVerified: false,
    });

    // Send the email
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
      resetOtp: null, // Use null instead of '' to clear the database field
      otpExpires: null, // Use null instead of undefined
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
}
