import { IsOptional, IsPositive, IsString, Matches, MaxLength } from 'class-validator';

export class CreateProductListingDto {
  @IsString()
  @MaxLength(120)
  productName: string;

  @IsPositive()
  quantity: number;

  @IsString()
  @MaxLength(20)
  unit: string;

  @IsPositive()
  askingPrice: number;

  @Matches(/^\d{11}$/, { message: 'Phone number must contain exactly 11 digits.' })
  phone: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  district?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}
