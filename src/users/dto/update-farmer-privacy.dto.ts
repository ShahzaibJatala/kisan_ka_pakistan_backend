import { IsOptional, IsBoolean } from 'class-validator';

export class UpdateFarmerPrivacyDto {
  @IsOptional()
  @IsBoolean()
  shareInCount?: boolean;

  @IsOptional()
  @IsBoolean()
  showOnArtiaProfile?: boolean;

  @IsOptional()
  @IsBoolean()
  showOwnDetailsPublicly?: boolean;
}
