import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { FarmerService } from './farmer.service';
import { RegisterFarmerDto } from './dto/register-farmer.dto';
import { UpdateFarmerProfileDto } from './dto/update-farmer-profile.dto';
import { PostCropPriceDto } from './dto/post-crop-price.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';
import { Role } from '@prisma/client';

interface RequestWithUser extends Request {
  user: {
    id: number;
    phone?: string | null;
    email?: string | null;
    role: string;
  };
}

@Controller('farmers')
export class FarmerController {
  constructor(private readonly farmerService: FarmerService) {}

  /**
   * 1. Self-Registration (POST /farmers/register)
   */
  @Post('register')
  async register(@Body() registerFarmerDto: RegisterFarmerDto) {
    return this.farmerService.register(registerFarmerDto);
  }

  /**
   * 2. Get Own Profile (GET /farmers/me)
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FARMER)
  @Get('me')
  async getProfile(@Req() req: RequestWithUser) {
    return this.farmerService.getProfile(req.user.id);
  }

  /**
   * 3. Update Profile / Privacy Consent (PATCH /farmers/me)
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FARMER)
  @Patch('me')
  async updateProfile(
    @Req() req: RequestWithUser,
    @Body() updateFarmerProfileDto: UpdateFarmerProfileDto,
  ) {
    return this.farmerService.updateProfile(
      req.user.id,
      updateFarmerProfileDto,
    );
  }

  /**
   * 4. Post Crop Price (POST /farmers/prices)
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FARMER)
  @Post('prices')
  async postCropPrice(
    @Req() req: RequestWithUser,
    @Body() postCropPriceDto: PostCropPriceDto,
  ) {
    return this.farmerService.postCropPrice(req.user.id, postCropPriceDto);
  }

  /**
   * 5. View Ledger (GET /farmers/me/ledger)
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FARMER)
  @Get('me/ledger')
  async getLedger(@Req() req: RequestWithUser) {
    return this.farmerService.getLedger(req.user.id);
  }
}
