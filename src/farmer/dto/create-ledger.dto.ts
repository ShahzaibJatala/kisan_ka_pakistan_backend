import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateLedgerDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  season?: string; // e.g. "Rabi 2024", "Kharif 2025"

  @IsOptional()
  @IsString()
  cropName?: string; // e.g. "Wheat", "Cotton", "Sugarcane"

  @IsOptional()
  @IsString()
  description?: string; // any extra notes
}
