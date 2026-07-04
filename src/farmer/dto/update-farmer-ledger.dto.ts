import { IsNumber, IsOptional } from 'class-validator';

export class UpdateFarmerLedgerDto {
  @IsNumber()
  @IsOptional()
  farmerId?: number;
}
