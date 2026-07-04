import { IsString, IsNumber, IsOptional, IsInt } from 'class-validator';

export class UpdatePriceDto {
  @IsOptional()
  @IsString()
  name_en?: string;

  @IsOptional()
  @IsString()
  name_ur?: string;

  @IsOptional()
  @IsNumber()
  price?: number;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  district?: string;

  @IsOptional()
  @IsString()
  quality?: string;

  @IsOptional()
  @IsString()
  additional_info?: string;

  @IsOptional()
  @IsInt()
  cropId?: number;

  @IsOptional()
  @IsInt()
  mandiId?: number;

  @IsOptional()
  @IsString()
  unit?: string;
}
