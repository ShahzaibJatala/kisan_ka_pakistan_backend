import { IsNumber, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator';

export class CreateFarmerProfileDto {
  @IsNumber()
  @IsNotEmpty()
  userId: number;

  @IsNumber()
  @IsOptional()
  artiaId?: number;

  @IsNumber()
  @IsOptional()
  mandiId?: number;

  @IsNumber()
  @IsOptional()
  landSize?: number;

  @IsBoolean()
  @IsOptional()
  showOnArtiaProfile?: boolean;
}
