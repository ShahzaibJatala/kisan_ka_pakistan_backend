import { Controller, Post, Body, Req, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';
import { Role } from '@prisma/client';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // Open endpoint to create SADAR
  @Post('sadar')
  createSadar(@Body() createUserDto: CreateUserDto) {
    createUserDto.role = Role.SADAR;
    return this.usersService.create(createUserDto);
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
}
