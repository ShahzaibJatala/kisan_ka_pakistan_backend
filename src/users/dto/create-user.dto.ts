import {
  IsString,
  IsNotEmpty,
  IsOptional,
  MinLength,
  IsEnum,
  IsInt,
} from 'class-validator';
import { Role, UserStatus } from '@prisma/client';

export class CreateUserDto {
  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  cnic?: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(4)
  password!: string;

  @IsNotEmpty()
  @IsString()
  name!: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsString()
  profileImage?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsInt()
  mandiId?: number;
}
