import { IsString, IsNotEmpty } from 'class-validator';

export class CreateMandiDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  city: string;
}
