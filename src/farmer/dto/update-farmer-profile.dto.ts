import { IsString, IsOptional, IsNumber, IsBoolean } from 'class-validator';

export class UpdateFarmerProfileDto {
  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsString()
  @IsOptional()
  profileImage?: string;

  @IsNumber()
  @IsOptional()
  landSize?: number;

  @IsBoolean()
  @IsOptional()
  showOnArtiaProfile?: boolean;

  @IsNumber()
  @IsOptional()
  artiaId?: number;

  @IsNumber()
  @IsOptional()
  mandiId?: number;
}
