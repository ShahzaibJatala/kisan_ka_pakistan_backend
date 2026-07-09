import { IsString, IsNotEmpty, IsNumber, IsEnum, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

export enum TransactionType {
  CREDIT = 'CREDIT',
  DEBIT = 'DEBIT',
}

export class AddTransactionDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsEnum(TransactionType, {
    message: 'type must be either CREDIT or DEBIT',
  })
  type: TransactionType;

  @IsOptional()
  @IsString()
  description?: string;
}
