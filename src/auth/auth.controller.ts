import { Controller, Post, Get, Body, Query, Res } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { SendOtpDto, VerifyOtpDto, ResetPasswordDto } from './dto/reset-password.dto';
import { SuperAdminLoginDto, SuperAdminVerifyOtpDto } from './dto/super-admin.dto';
import type { Response } from 'express';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body() loginDto: LoginDto) {
    const user = await this.authService.validateUser(loginDto);
    return this.authService.login(user);
  }

  @Post('send-otp')
  async sendOtp(@Body() sendOtpDto: SendOtpDto) {
    return this.authService.sendOTP(sendOtpDto);
  }

  @Post('verify-otp')
  async verifyOtp(@Body() verifyOtpDto: VerifyOtpDto) {
    return this.authService.verifyOTP(verifyOtpDto);
  }

  @Post('reset-password')
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
  }

  @Get('dashboard-login')
  async dashboardLogin(
    @Query('token') token: string,
    @Res() res: Response,
  ) {
    const user = await this.authService.verifyDashboardLoginToken(token);
    const { accessToken, refreshToken } = await this.authService.generateTokens(user);

    // Set HTTP-only cookies for both access and refresh tokens
    res.cookie('access_token', accessToken, {
      httpOnly: true,
      secure: false, // Set to true if HTTPS in production
      maxAge: 3600000, // 1 hour
      path: '/',
    });
    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: false, // Set to true if HTTPS in production
      maxAge: 7 * 24 * 3600000, // 7 days
      path: '/',
    });

    // Redirect to frontend dashboard
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000/dashboard';
    return res.redirect(frontendUrl);
  }

  @Post('super-admin/login')
  async superAdminLogin(@Body() dto: SuperAdminLoginDto) {
    return this.authService.superAdminLogin(dto);
  }

  @Post('super-admin/verify-otp')
  async superAdminVerifyOtp(
    @Body() dto: SuperAdminVerifyOtpDto,
    @Res() res: Response,
  ) {
    const result = await this.authService.superAdminVerifyOtp(dto);

    // Set HTTP-only cookies for both access and refresh tokens
    res.cookie('access_token', result.accessToken, {
      httpOnly: true,
      secure: false, // Set to true if HTTPS in production
      maxAge: 3600000, // 1 hour
      path: '/',
    });
    res.cookie('refresh_token', result.refreshToken, {
      httpOnly: true,
      secure: false, // Set to true if HTTPS in production
      maxAge: 7 * 24 * 3600000, // 7 days
      path: '/',
    });

    return res.json({
      message: result.message,
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
  }
}
