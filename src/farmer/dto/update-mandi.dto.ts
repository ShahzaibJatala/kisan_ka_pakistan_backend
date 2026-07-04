import { IsString, IsOptional } from 'class-validator';

export class UpdateMandiDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  city?: string;
}
