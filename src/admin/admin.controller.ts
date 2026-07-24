import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';
import { AdminService } from './admin.service';
import { CreateSuperAdminDto } from '../auth/dto/super-admin.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}
  @Get('users') users(@Query('role') role?: Role, @Query('status') status?: UserStatus) { return this.admin.users(role, status); }
  @Get('super-admins') superAdmins() { return this.admin.superAdmins(); }
  @Post('super-admins') createSuperAdmin(@Body() dto: CreateSuperAdminDto, @Req() req: any) { return this.admin.createSuperAdmin(dto, req.user.id); }
  @Get('users/:id') userDetails(@Param('id', ParseIntPipe) id: number) { return this.admin.userDetails(id); }
  @Patch('users/:id') updateUser(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) { return this.admin.updateUser(id, body); }
  @Get('stats') stats() { return this.admin.stats(); }
  @Get('mandis') mandis() { return this.admin.mandis(); }
  @Get('limit-requests') limitRequests() { return this.admin.pendingLimitRequests(); }
  @Patch('limit-requests/:id/approve') approveLimitRequest(@Param('id', ParseIntPipe) id: number, @Req() req: any, @Body('reason') reason?: string) { return this.admin.approveLimitRequest(id, req.user.id, reason); }
  @Patch('limit-requests/:id/reject') rejectLimitRequest(@Param('id', ParseIntPipe) id: number, @Req() req: any, @Body('reason') reason?: string) { return this.admin.rejectLimitRequest(id, req.user.id, reason); }
  @Patch('users/:id/approve') approve(@Param('id', ParseIntPipe) id: number, @Body('reason') reason?: string) { return this.admin.setStatus(id, UserStatus.VERIFIED, reason); }
  @Patch('users/:id/reject') reject(@Param('id', ParseIntPipe) id: number, @Body('reason') reason?: string) { return this.admin.setStatus(id, UserStatus.REJECTED, reason); }
  @Patch('users/:id/suspend') suspend(@Param('id', ParseIntPipe) id: number, @Body('reason') reason?: string) { return this.admin.setStatus(id, UserStatus.SUSPENDED, reason); }
  @Patch('users/:id/activate') activate(@Param('id', ParseIntPipe) id: number, @Body('reason') reason?: string) { return this.admin.setStatus(id, UserStatus.VERIFIED, reason); }
  @Patch('farmers/:farmerId/artias/:artiaId/suspend') suspendConnection(@Param('farmerId', ParseIntPipe) farmerId: number, @Param('artiaId', ParseIntPipe) artiaId: number, @Body('reason') reason?: string) { return this.admin.setFarmerConnectionStatus(farmerId, artiaId, 'SUSPENDED', reason); }
  @Patch('farmers/:farmerId/artias/:artiaId/activate') activateConnection(@Param('farmerId', ParseIntPipe) farmerId: number, @Param('artiaId', ParseIntPipe) artiaId: number, @Body('reason') reason?: string) { return this.admin.setFarmerConnectionStatus(farmerId, artiaId, 'ACTIVE', reason); }
}
