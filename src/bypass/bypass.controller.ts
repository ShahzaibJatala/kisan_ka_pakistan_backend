import { Controller, Get, Post, Body, Param, Req, UseGuards, ParseIntPipe } from '@nestjs/common';
import { BypassService } from './bypass.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';
import { Role } from '@prisma/client';

@Controller('bypass-requests')
export class BypassController {
  constructor(private readonly bypassService: BypassService) {}

  /** A farmer can request a limit override for a connection they are accepting. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FARMER)
  @Post()
  createBypassRequest(
    @Req() req: any,
    @Body()
    dto: {
      farmerName: string;
      farmerPhone: string;
      farmerCnic: string;
      targetArtiaId?: number;
      targetArtiaPhone?: string;
      reason?: string;
      targetRole?: string;
    },
  ) {
    return this.bypassService.createBypassRequest(req.user.id, dto);
  }

  /**
   * 2. Get bypass requests for the logged-in Sadar or Super Admin
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SADAR, Role.SUPER_ADMIN)
  @Get()
  getBypassRequests(@Req() req: any) {
    return this.bypassService.getBypassRequests(req.user);
  }

  /**
   * 3. Approve a request
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SADAR, Role.SUPER_ADMIN)
  @Post(':id/approve')
  approveRequest(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.bypassService.approveBypassRequest(id, req.user.id);
  }

  /**
   * 4. Reject a request
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SADAR, Role.SUPER_ADMIN)
  @Post(':id/reject')
  rejectRequest(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.bypassService.rejectBypassRequest(id, req.user.id);
  }
}
