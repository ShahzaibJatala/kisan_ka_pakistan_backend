import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class UpdateArtiaProfileDto {
  @IsOptional()
  @IsString()
  shopName?: string;

  @IsOptional()
  @IsString()
  shopPhone?: string;

  @IsOptional()
  @IsString()
  secondPhone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  commissionRules?: string;

  @IsOptional()
  @IsBoolean()
  showFarmerCount?: boolean;

  @IsOptional()
  @IsBoolean()
  showFarmerDetails?: boolean;
}
