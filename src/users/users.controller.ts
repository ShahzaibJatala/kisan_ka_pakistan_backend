import { Controller, Post, Get, Body, Req, UseGuards, Query } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';
import { Role } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  // Open endpoint supporting both SUPER_ADMIN creation & user self-registration
  @Post('sadar')
  async createSadar(@Body() createUserDto: CreateUserDto, @Req() req: any) {
    let creator: { id: number; role: Role } | undefined;
    
    const token = this.extractToken(req);
    if (token) {
      try {
        const decoded = this.jwtService.verify(token);
        if (decoded && decoded.role === Role.SUPER_ADMIN) {
          creator = { id: decoded.sub, role: decoded.role as Role };
        }
      } catch (e) {
        // Ignore token parse errors, fallback to user self-registration
      }
    }

    return this.usersService.createSadar(createUserDto, creator);
  }

  // ARTIA created by SADAR
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SADAR)
  @Post('artia')
  createArtia(@Body() createUserDto: CreateUserDto, @Req() req: any) {
    createUserDto.role = Role.ARTIA;
    return this.usersService.create(createUserDto, req.user.role, req.user.id);
  }

  // FARMER created by ARTIA (or SADAR optionally)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SADAR, Role.ARTIA)
  @Post('farmer')
  createFarmer(@Body() createUserDto: CreateUserDto, @Req() req: any) {
    createUserDto.role = Role.FARMER;
    return this.usersService.create(createUserDto, req.user.role, req.user.id);
  }

  // Request verification from a verifier
  @UseGuards(JwtAuthGuard)
  @Post('request-verification')
  requestVerification(@Body('verifierId') verifierId: number, @Req() req: any) {
    return this.usersService.requestVerification(req.user.id, verifierId);
  }

  // Public verification endpoint hit from email verify button
  @Get('confirm-verification')
  confirmVerification(@Query('token') token: string) {
    return this.usersService.confirmVerification(token);
  }

  // Separately send the verification success email to verified user
  @Post('send-verification-email')
  sendVerificationEmail(@Body('userId') userId: number) {
    return this.usersService.sendVerificationSuccessEmail(userId);
  }

  private extractToken(req: any): string | null {
    if (req.headers.authorization) {
      const parts = req.headers.authorization.split(' ');
      if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
        return parts[1];
      }
    }
    if (req.headers['access_token']) {
      return req.headers['access_token'] as string;
    }
    if (req.cookies && req.cookies['access_token']) {
      return req.cookies['access_token'];
    }
    return null;
  }
}
