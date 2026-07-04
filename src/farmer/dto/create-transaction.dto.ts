import { IsNumber, IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class CreateTransactionDto {
  @IsNumber()
  @IsNotEmpty()
  ledgerId: number;

  @IsNumber()
  @IsNotEmpty()
  amount: number;

  @IsString()
  @IsNotEmpty()
  type: string; // 'CREDIT' | 'DEBIT'

  @IsString()
  @IsOptional()
  description?: string;
}
