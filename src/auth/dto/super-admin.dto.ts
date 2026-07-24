import { IsString, IsNotEmpty, IsEmail, IsOptional, Matches, MaxLength, MinLength } from 'class-validator';

export class SuperAdminLoginDto {
  @IsOptional()
  @IsString()
  username?: string;

  @IsNotEmpty()
  @IsEmail()
  email: string;

  @IsNotEmpty()
  @IsString()
  password: string;
}

export class SuperAdminVerifyOtpDto {
  @IsNotEmpty()
  @IsString()
  otp: string;
}

export class CreateSuperAdminDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @IsOptional()
  @Matches(/^\d{11}$/, { message: 'Phone number must contain exactly 11 digits.' })
  phone?: string;
}
