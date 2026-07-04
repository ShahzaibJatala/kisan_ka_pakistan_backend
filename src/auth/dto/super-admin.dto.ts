import { IsString, IsNotEmpty, IsEmail } from 'class-validator';

export class SuperAdminLoginDto {
  @IsNotEmpty()
  @IsString()
  username: string;

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
