import { IsNumber, IsNotEmpty } from 'class-validator';

export class CreateFarmerLedgerDto {
  @IsNumber()
  @IsNotEmpty()
  farmerId: number;
}
