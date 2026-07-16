import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Req,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { FarmerService } from './farmer.service';
import { RegisterFarmerDto } from './dto/register-farmer.dto';
import { UpdateFarmerProfileDto } from './dto/update-farmer-profile.dto';
import { PostCropPriceDto } from './dto/post-crop-price.dto';
import { CreateLedgerDto } from './dto/create-ledger.dto';
import { UpdateLedgerDto } from './dto/update-ledger.dto';
import { AddTransactionDto } from './dto/add-transaction.dto';
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

  // ─── PUBLIC ───────────────────────────────────────────────────────────────

  /** POST /farmers/register */
  @Post('register')
  async register(@Body() registerFarmerDto: RegisterFarmerDto) {
    return this.farmerService.register(registerFarmerDto);
  }

  // ─── FARMER SELF ROUTES ───────────────────────────────────────────────────

  /** GET /farmers/me */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FARMER)
  @Get('me')
  async getProfile(@Req() req: RequestWithUser) {
    return this.farmerService.getProfile(req.user.id);
  }

  /** PATCH /farmers/me */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FARMER)
  @Patch('me')
  async updateProfile(
    @Req() req: RequestWithUser,
    @Body() updateFarmerProfileDto: UpdateFarmerProfileDto,
  ) {
    return this.farmerService.updateProfile(req.user.id, updateFarmerProfileDto);
  }

  /** POST /farmers/prices */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FARMER)
  @Post('prices')
  async postCropPrice(
    @Req() req: RequestWithUser,
    @Body() postCropPriceDto: PostCropPriceDto,
  ) {
    return this.farmerService.postCropPrice(req.user.id, postCropPriceDto);
  }

  /** GET /farmers/me/ledgers — Farmer views their own ledgers */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FARMER)
  @Get('me/ledgers')
  async getLedger(@Req() req: RequestWithUser) {
    return this.farmerService.getLedger(req.user.id);
  }

  /** POST /farmers/leave-artia — Farmer leaves current artia */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FARMER)
  @Post('leave-artia')
  async leaveArtia(@Req() req: RequestWithUser) {
    return this.farmerService.leaveArtia(req.user.id);
  }

  /** GET /farmers/previous-artias — Farmer gets previous artias + ledger summaries */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FARMER)
  @Get('previous-artias')
  async getPreviousArtias(@Req() req: RequestWithUser) {
    return this.farmerService.getPreviousArtias(req.user.id);
  }

  // ─── ARTIA ROUTES (static paths MUST come before parameterized paths) ─────

  /** GET /farmers/personal-ledger — Fetch Artia's personal ledger */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ARTIA)
  @Get('personal-ledger')
  async getPersonalLedger(@Req() req: RequestWithUser) {
    return this.farmerService.getOrCreatePersonalLedger(req.user.id);
  }

  /** PATCH /farmers/personal-ledger — Update Artia's personal ledger name/description */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ARTIA)
  @Patch('personal-ledger')
  async updatePersonalLedger(
    @Req() req: RequestWithUser,
    @Body() updateLedgerDto: UpdateLedgerDto,
  ) {
    return this.farmerService.updatePersonalLedger(req.user.id, updateLedgerDto);
  }

  /** POST /farmers/personal-ledger/transactions — Add transaction to personal ledger */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ARTIA)
  @Post('personal-ledger/transactions')
  async addPersonalTransaction(
    @Req() req: RequestWithUser,
    @Body() addTransactionDto: AddTransactionDto,
  ) {
    return this.farmerService.addPersonalTransaction(req.user.id, addTransactionDto);
  }

  /** GET /farmers/artia/dashboard — Artia sees all farmers + their ledgers */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ARTIA)
  @Get('artia/dashboard')
  async getArtiaFarmersDashboard(@Req() req: RequestWithUser) {
    return this.farmerService.getArtiaFarmersDashboard(req.user.id);
  }

  /** POST /farmers/:farmerId/remove — Artia removes farmer */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ARTIA)
  @Post(':farmerId/remove')
  async removeFarmer(
    @Req() req: RequestWithUser,
    @Param('farmerId', ParseIntPipe) farmerId: number,
  ) {
    return this.farmerService.removeFarmer(req.user.id, farmerId);
  }

  /** GET /farmers/artia/left-farmers — Artia gets left farmers + ledger summaries */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ARTIA)
  @Get('artia/left-farmers')
  async getLeftFarmers(@Req() req: RequestWithUser) {
    return this.farmerService.getLeftFarmers(req.user.id);
  }

  /** POST /farmers/ledgers/:ledgerId/transactions — Artia adds a transaction */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ARTIA)
  @Post('ledgers/:ledgerId/transactions')
  async addTransaction(
    @Req() req: RequestWithUser,
    @Param('ledgerId', ParseIntPipe) ledgerId: number,
    @Body() addTransactionDto: AddTransactionDto,
  ) {
    return this.farmerService.addTransaction(req.user.id, ledgerId, addTransactionDto);
  }

  /** PATCH /farmers/ledgers/:ledgerId — Artia edits a ledger */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ARTIA)
  @Patch('ledgers/:ledgerId')
  async updateLedger(
    @Req() req: RequestWithUser,
    @Param('ledgerId', ParseIntPipe) ledgerId: number,
    @Body() updateLedgerDto: UpdateLedgerDto,
  ) {
    return this.farmerService.updateLedger(req.user.id, ledgerId, updateLedgerDto);
  }

  /** GET /farmers/:farmerId/ledgers — Artia views specific farmer's ledgers */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ARTIA)
  @Get(':farmerId/ledgers')
  async getFarmerLedgers(
    @Req() req: RequestWithUser,
    @Param('farmerId', ParseIntPipe) farmerId: number,
  ) {
    return this.farmerService.getFarmerLedgers(req.user.id, farmerId);
  }

  /** POST /farmers/:farmerId/ledgers — Artia creates a ledger for a farmer */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ARTIA)
  @Post(':farmerId/ledgers')
  async createLedger(
    @Req() req: RequestWithUser,
    @Param('farmerId', ParseIntPipe) farmerId: number,
    @Body() createLedgerDto: CreateLedgerDto,
  ) {
    return this.farmerService.createLedger(req.user.id, farmerId, createLedgerDto);
  }
}
