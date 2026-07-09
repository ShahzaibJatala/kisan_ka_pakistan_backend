import { IsString, IsOptional } from 'class-validator';

export class UpdateLedgerDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  season?: string;

  @IsOptional()
  @IsString()
  cropName?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
