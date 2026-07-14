import { Controller, Post, Get, Body, Query, Req, Res, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import {
  SendOtpDto,
  VerifyOtpDto,
  ResetPasswordDto,
} from './dto/reset-password.dto';
import {
  SuperAdminLoginDto,
  SuperAdminVerifyOtpDto,
} from './dto/super-admin.dto';
import type { Response } from 'express';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RateLimiterGuard } from './guards/rate-limiter.guard';
import { OtpRateLimiterGuard } from './guards/otp-rate-limiter.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @UseGuards(RateLimiterGuard)
  @Post('login')
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.authService.validateUser(loginDto);
    const result = await this.authService.login(user);

    // Set refresh token in httpOnly cookie
    res.cookie('refresh_token', result.refresh_token, {
      httpOnly: true,
      secure: false, // Set to true in production if using HTTPS
      maxAge: 7 * 24 * 3600000, // 7 days
      path: '/',
    });

    const { refresh_token, ...responseBody } = result;
    return responseBody;
  }

  @Post('google')
  async googleLogin(
    @Body('idToken') idToken: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.googleLogin(idToken);

    // Set refresh token in httpOnly cookie
    res.cookie('refresh_token', result.refresh_token, {
      httpOnly: true,
      secure: false, // Set to true in production if using HTTPS
      maxAge: 7 * 24 * 3600000, // 7 days
      path: '/',
    });

    const { refresh_token, ...responseBody } = result;
    return responseBody;
  }

  @UseGuards(OtpRateLimiterGuard)
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

  /**
   * POST /auth/refresh
   * Body: { "refresh_token": "eyJ..." }
   * Returns: { "access_token": "eyJ..." }
   */
  @UseGuards(JwtRefreshGuard)
  @Post('refresh')
  async refresh(@Req() req: any) {
    return this.authService.refreshAccessToken(req.user);
  }

  /**
   * POST /auth/logout
   * Requires valid access token. Clears refresh token from DB.
   */
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.clearCookie('refresh_token', { path: '/' });
    return this.authService.logout(req.user.id);
  }

  @Get('dashboard-login')
  async dashboardLogin(@Query('token') token: string, @Res() res: Response) {
    const user = await this.authService.verifyDashboardLoginToken(token);
    const { accessToken, refreshToken } =
      await this.authService.generateTokens(user);

    // Set HTTP-only cookies for both access and refresh tokens
    res.cookie('access_token', accessToken, {
      httpOnly: true,
      secure: false,
      maxAge: 15 * 60 * 1000, // 15 minutes
      path: '/',
    });
    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: false,
      maxAge: 7 * 24 * 3600000, // 7 days
      path: '/',
    });

    // Redirect to frontend dashboard with role-based path
    let baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    if (baseUrl.endsWith('/')) {
      baseUrl = baseUrl.slice(0, -1);
    }

    const rolePath = user.role.toLowerCase().replace('_', '-');
    const redirectUrl = `${baseUrl}/${rolePath}/dashboard?accessToken=${accessToken}`;

    return res.redirect(redirectUrl);
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

    res.cookie('access_token', result.accessToken, {
      httpOnly: true,
      secure: false,
      maxAge: 15 * 60 * 1000,
      path: '/',
    });
    res.cookie('refresh_token', result.refreshToken, {
      httpOnly: true,
      secure: false,
      maxAge: 7 * 24 * 3600000,
      path: '/',
    });

    return res.json({
      message: result.message,
      user: result.user,
      accessToken: result.accessToken,
    });
  }
}
