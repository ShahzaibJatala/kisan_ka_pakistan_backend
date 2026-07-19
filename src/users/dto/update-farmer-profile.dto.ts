import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsInt,
  Matches,
} from 'class-validator';

export class UpdateFarmerProfileDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{11}$/, { message: 'Phone number must be exactly 11 digits.' })
  phone?: string;

  @IsOptional()
  @IsString()
  cnic?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsNumber()
  landSize?: number;

  @IsOptional()
  @IsInt()
  mandiId?: number;

  @IsOptional()
  @IsBoolean()
  showOnArtiaProfile?: boolean;

  @IsOptional()
  @IsBoolean()
  shareInCount?: boolean;

  @IsOptional()
  @IsBoolean()
  showOwnDetailsPublicly?: boolean;
}
