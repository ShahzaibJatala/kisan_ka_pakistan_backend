import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsPositive, IsString, Matches, MaxLength, Min, ValidateNested } from 'class-validator';

export class CreatePesticideShopDto {
  @IsString() @MaxLength(120) name: string;
  @IsString() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) slug: string;
  @IsString() @MaxLength(30) phone: string;
  @IsOptional() @Type(() => Number) @IsInt() ownerId?: number;
  @IsOptional() @IsString() @MaxLength(120) ownerName?: string;
  @IsOptional() @IsEmail() ownerEmail?: string;
  @IsOptional() @IsString() @MaxLength(30) ownerPhone?: string;
  @IsOptional() @IsString() @MaxLength(160) businessName?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(400) address?: string;
  @IsOptional() @IsString() @MaxLength(100) city?: string;
  @IsOptional() @IsString() @MaxLength(100) district?: string;
  @IsOptional() @IsString() @MaxLength(100) licenseNumber?: string;
}

export class UpdatePesticideShopDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(160) businessName?: string;
  @IsOptional() @IsString() @MaxLength(180) tagline?: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsString() @MaxLength(30) whatsapp?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(400) address?: string;
  @IsOptional() @IsString() @MaxLength(100) city?: string;
  @IsOptional() @IsString() @MaxLength(100) district?: string;
  @IsOptional() @IsString() @MaxLength(100) licenseNumber?: string;
  @IsOptional() @IsString() @MaxLength(500) logoUrl?: string;
  @IsOptional() @IsString() @MaxLength(500) coverUrl?: string;
  @IsOptional() @IsString() @MaxLength(70) seoTitle?: string;
  @IsOptional() @IsString() @MaxLength(160) seoDescription?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(15) @IsString({ each: true }) seoKeywords?: string[];
  @IsOptional() @IsString() @MaxLength(500) googleBusinessUrl?: string;
}

export class CreatePesticideProductDto {
  @IsString() @MaxLength(160) name: string;
  @IsString() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) slug: string;
  @IsString() @MaxLength(100) sku: string;
  @IsString() @MaxLength(60) packSize: string;
  @IsNumber() @Min(0) price: number;
  @IsOptional() @IsInt() @Min(0) stockQuantity?: number;
  @IsOptional() @IsString() @MaxLength(100) brand?: string;
  @IsOptional() @IsString() @MaxLength(100) category?: string;
  @IsOptional() @IsString() @MaxLength(160) genericName?: string;
  @IsOptional() @IsString() @MaxLength(300) activeIngredient?: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @IsOptional() @IsString() @MaxLength(4000) usageInstructions?: string;
  @IsOptional() @IsString() @MaxLength(4000) safetyInformation?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) suitableCrops?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) targetPests?: string[];
  @IsOptional() isCreditEligible?: boolean;
  @IsOptional() isDeliveryEligible?: boolean;
}
export class CreateShopOfferDto { @IsInt() @IsPositive() catalogProductId: number; @IsNumber() @Min(0) price: number; @IsInt() @Min(0) stockQuantity: number; }
export class RequestCatalogProductDto { @IsString() @MaxLength(160) genericName: string; @IsString() @MaxLength(100) brand: string; @IsOptional() @IsString() @MaxLength(200) displayName?: string; @IsOptional() @IsString() @MaxLength(100) category?: string; @IsOptional() @IsString() @MaxLength(4000) description?: string; @IsString() @MaxLength(500) photoUrl: string; @IsOptional() @IsString() @MaxLength(60) standardUnit?: string; @IsOptional() @IsNumber() @Min(0) requestedPrice?: number; @IsOptional() @IsInt() @Min(0) requestedStockQuantity?: number; }
export class ReviewCatalogProductDto { @IsIn(['APPROVE', 'REJECT', 'SAME_PRODUCT']) decision: 'APPROVE' | 'REJECT' | 'SAME_PRODUCT'; @IsOptional() @IsInt() @IsPositive() matchedCatalogProductId?: number; @IsOptional() @IsString() @MaxLength(1000) reason?: string; @IsOptional() @IsNumber() @Min(0) price?: number; @IsOptional() @IsInt() @Min(0) stockQuantity?: number; }

export class PesticideOrderItemDto { @IsInt() @IsPositive() productId: number; @IsInt() @Min(1) quantity: number; }
export class CheckoutPesticideDto {
  @IsInt() @IsPositive() shopId: number;
  @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => PesticideOrderItemDto) items: PesticideOrderItemDto[];
  @IsString() @MaxLength(120) customerName: string;
  @IsString() @Matches(/^\d{11}$/, { message: 'Customer phone number must contain exactly 11 digits.' }) customerPhone: string;
  @IsOptional() @IsEmail() customerEmail?: string;
  @IsString() @MaxLength(500) deliveryAddress: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class ArtiaConnectionDto {
  @IsOptional() @IsInt() @IsPositive() artiaId?: number;
  @IsOptional() @IsNumber() @Min(0) creditLimit?: number;
  @IsOptional() @IsString() @MaxLength(1000) settlementTerms?: string;
}
export class ConnectionDecisionDto { @IsIn(['ACCEPT', 'REJECT', 'SUSPEND']) decision: 'ACCEPT' | 'REJECT' | 'SUSPEND'; @IsOptional() @IsString() @MaxLength(1000) reason?: string; }
export class UpdatePesticideOrderStatusDto { @IsIn(['PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED']) status: 'PENDING' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED'; }
export class ReviewPesticideShopDto { @IsInt() @Min(1) rating: number; @IsOptional() @IsString() @MaxLength(1000) body?: string; }
export class ReceiptItemDto { @IsInt() @IsPositive() productId: number; @IsInt() @Min(1) quantity: number; }
export class IssueArtiaReceiptDto { @IsInt() @IsPositive() artiaId: number; @IsInt() @IsPositive() farmerId: number; @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => ReceiptItemDto) items: ReceiptItemDto[]; }
