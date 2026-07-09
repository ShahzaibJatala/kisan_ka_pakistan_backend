import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  MinLength,
} from 'class-validator';

export class RegisterFarmerDto {
  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsString()
  @IsNotEmpty()
  cnic!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6, { message: 'Password must be at least 6 characters long' })
  password!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsNumber()
  @IsOptional()
  mandiId?: number;

  @IsNumber()
  @IsOptional()
  artiaId?: number;
}
