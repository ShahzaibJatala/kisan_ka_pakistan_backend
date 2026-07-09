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
  @IsString()
  phone!: string;

  @IsString()
  email!: string;

  @IsString()
  cnic!: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  password!: string;

  @IsString()
  name!: string;

  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsString()
  profileImage?: string;

  @IsString()
  address?: string;

  @IsString()
  city!: string;

  @IsOptional()
  @IsInt()
  mandiId?: number;
}
