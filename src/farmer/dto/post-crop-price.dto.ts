import { IsNumber, IsNotEmpty, IsString } from 'class-validator';

export class PostCropPriceDto {
  @IsNumber()
  @IsNotEmpty()
  cropId: number;

  @IsNumber()
  @IsNotEmpty()
  mandiId: number;

  @IsNumber()
  @IsNotEmpty()
  price: number;

  @IsString()
  @IsNotEmpty()
  unit: string;
}
