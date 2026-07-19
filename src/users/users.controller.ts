import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Req,
  UseGuards,
  Query,
  Param,
  ParseIntPipe,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateArtiaProfileDto } from './dto/update-artia-profile.dto';
import { UpdateFarmerPrivacyDto } from './dto/update-farmer-privacy.dto';
import { UpdateFarmerProfileDto } from './dto/update-farmer-profile.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';
import { Role } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { RateLimiterGuard } from '../auth/guards/rate-limiter.guard';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  // Open endpoint supporting both SUPER_ADMIN creation & user self-registration
  @UseGuards(RateLimiterGuard)
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

  // FARMER created by ARTIA
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ARTIA)
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

  // Verification endpoint called by the frontend website verify-user page
  @UseGuards(JwtAuthGuard)
  @Get('confirm-verification')
  confirmVerification(@Query('token') token: string, @Req() req: any) {
    return this.usersService.confirmVerification(token, req.user.id);
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

  // API to get all Artias for a Sadar
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SADAR)
  @Get('sadar/artias')
  getSadarArtias(@Req() req: any) {
    return this.usersService.getSadarArtias(req.user.id);
  }

  // API to get all Farmers for an Artia
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ARTIA)
  @Get('artia/farmers')
  getArtiaFarmers(@Req() req: any) {
    return this.usersService.getArtiaFarmers(req.user.id);
  }

  // API to get the Artia (and Mandi) for a Farmer
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FARMER)
  @Get('farmer/artia')
  getFarmerArtia(@Req() req: any) {
    return this.usersService.getFarmerArtia(req.user.id);
  }

  // API to get recent activity of a user
  @UseGuards(JwtAuthGuard)
  @Get(':userId/activity')
  getRecentActivity(@Param('userId', ParseIntPipe) userId: number) {
    return this.usersService.getRecentActivity(userId);
  }

  // Get verified independent farmers (available to Artias)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ARTIA)
  @Get('independent-farmers')
  getIndependentFarmers(@Query('search') search?: string) {
    return this.usersService.getIndependentFarmers(search);
  }

  // Artia requests to connect with/import an independent farmer
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ARTIA)
  @Post('import-farmer')
  importFarmer(@Body('farmerId', ParseIntPipe) farmerId: number, @Req() req: any) {
    return this.usersService.createConnectionRequest(req.user.id, farmerId);
  }

  // Get active connection requests (for notifications)
  @UseGuards(JwtAuthGuard)
  @Get('connection-requests')
  getConnectionRequests(@Req() req: any) {
    return this.usersService.getConnectionRequests(req.user.id, req.user.role);
  }

  // Farmer accepts connection request
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FARMER)
  @Post('connection-requests/:requestId/accept')
  acceptConnection(@Param('requestId', ParseIntPipe) requestId: number, @Req() req: any) {
    return this.usersService.acceptConnectionRequest(requestId, req.user.id);
  }

  // Farmer rejects connection request
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FARMER)
  @Post('connection-requests/:requestId/reject')
  rejectConnection(@Param('requestId', ParseIntPipe) requestId: number, @Req() req: any) {
    return this.usersService.rejectConnectionRequest(requestId, req.user.id);
  }

  // GET Artia own profile (requires auth & role ARTIA)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ARTIA)
  @Get('artia/profile')
  getArtiaProfile(@Req() req: any) {
    return this.usersService.getArtiaProfile(req.user.id);
  }

  // PATCH Artia own profile (requires auth & role ARTIA)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ARTIA)
  @Patch('artia/profile')
  updateArtiaProfile(@Body() dto: UpdateArtiaProfileDto, @Req() req: any) {
    return this.usersService.updateArtiaProfile(req.user.id, dto);
  }

  // PATCH Farmer own privacy settings (requires auth & role FARMER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FARMER)
  @Patch('farmer/privacy')
  updateFarmerPrivacy(@Body() dto: UpdateFarmerPrivacyDto, @Req() req: any) {
    return this.usersService.updateFarmerPrivacy(req.user.id, dto);
  }

  // GET Farmer own profile details (requires auth & role FARMER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FARMER)
  @Get('farmer/profile')
  getFarmerProfile(@Req() req: any) {
    return this.usersService.getFarmerProfile(req.user.id);
  }

  // PATCH Farmer own profile details (requires auth & role FARMER)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FARMER)
  @Patch('farmer/profile')
  updateFarmerProfile(@Body() dto: UpdateFarmerProfileDto, @Req() req: any) {
    return this.usersService.updateFarmerProfile(req.user.id, dto);
  }

  // GET user notifications
  @UseGuards(JwtAuthGuard)
  @Get('notifications')
  getNotifications(@Req() req: any) {
    return this.usersService.getNotifications(req.user.id);
  }

  // PATCH mark notification read
  @UseGuards(JwtAuthGuard)
  @Patch('notifications/:id/read')
  markNotificationRead(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.usersService.markNotificationRead(req.user.id, id);
  }

  // POST respond to privacy consent request
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FARMER)
  @Post('notifications/:id/respond')
  respondToConsent(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: { shareInCount: boolean; showOnArtiaProfile: boolean },
    @Req() req: any
  ) {
    return this.usersService.respondToConsent(req.user.id, id, dto);
  }

  // GET Public list of all verified Artias
  @Get('artia/public-list')
  getPublicArtiaList() {
    return this.usersService.getPublicArtiaList();
  }

  // GET Public Artia Profile (No auth needed)
  @Get('artia/:id/public-profile')
  getPublicArtiaProfile(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.getPublicArtiaProfile(id);
  }

  // GET Public Farmer Profile (Supported public view or Admin access)
  @Get('farmer/:id/public-profile')
  getPublicFarmerProfile(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    let requesterRole: Role | undefined;
    const token = this.extractToken(req);
    if (token) {
      try {
        const decoded = this.jwtService.verify(token);
        requesterRole = decoded.role as Role;
      } catch (e) {
        // Ignored
      }
    }
    return this.usersService.getPublicFarmerProfile(id, requesterRole);
  }
}
