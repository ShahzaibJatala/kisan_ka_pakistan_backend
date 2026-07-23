import { IsString, IsNotEmpty, IsEmail, IsOptional } from 'class-validator';

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
