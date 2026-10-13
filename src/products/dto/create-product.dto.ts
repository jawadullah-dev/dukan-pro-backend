import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateProductDto {
  @ApiProperty({
    description:
      'Product name shown in every picker. Unique inside a single shop (case-sensitive).',
    example: 'Galaxy A15',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(2, 100)
  name: string;

  @ApiProperty({
    description:
      'UUID of a category owned by the shop in the JWT. Cannot point at another shop.',
    example: '01924f0a-0000-7000-8000-000000000000',
  })
  @IsUUID()
  categoryId: string;

  @ApiProperty({
    description:
      'UUID of a brand owned by the shop in the JWT. Cannot point at another shop.',
    example: '01924f0a-0000-7000-8000-000000000001',
  })
  @IsUUID()
  brandId: string;

  @ApiProperty({
    description:
      'QUANTITY = stock is a simple counter (covers, cables). SERIALIZED = every unit is tracked by its own IMEI (phones). QUANTITY products get a stock_levels row on creation; SERIALIZED ones do not. Locked once the product has any purchase or sale.',
    enum: ['QUANTITY', 'SERIALIZED'],
    example: 'SERIALIZED',
  })
  @IsIn(['QUANTITY', 'SERIALIZED'])
  trackingType: 'QUANTITY' | 'SERIALIZED';

  @ApiPropertyOptional({
    description: 'Model number / marketing name.',
    example: 'SM-A155F',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;

  @ApiPropertyOptional({ example: 'Blue' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MaxLength(50)
  color?: string;

  @ApiPropertyOptional({ example: '8GB' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MaxLength(50)
  ram?: string;

  @ApiPropertyOptional({ example: '128GB' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MaxLength(50)
  storage?: string;

  @ApiPropertyOptional({
    description:
      'Stock keeping unit. Optional. When set it must be unique inside the shop. NULLs are allowed repeatedly.',
    example: 'A15-BLU-128',
    maxLength: 100,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @Length(1, 100)
  sku?: string;

  @ApiPropertyOptional({
    description:
      'Barcode / IMEI label. Optional. Unique inside the shop when set.',
    example: '356938035643809',
    maxLength: 100,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @Length(1, 100)
  barcode?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({
    description: 'Absolute image URL. The backend stores the string only.',
    example: 'https://cdn.example.com/a15.jpg',
  })
  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: false }, { message: 'imageUrl must be a valid URL' })
  @MaxLength(500)
  imageUrl?: string;

  @ApiPropertyOptional({
    description:
      'Suggested cost in PAISA (Rs 1 = 100 paisa). Integer only. A hint for the purchase screen — the real cost is recorded on each purchase.',
    example: 4500000,
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  defaultPurchasePrice?: number;

  @ApiPropertyOptional({
    description:
      'Suggested selling price in PAISA (Rs 1 = 100 paisa). Integer only. A hint for the sale screen — the real price is decided per sale.',
    example: 699900,
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  defaultSellingPrice?: number;

  @ApiPropertyOptional({
    description:
      'Show a low-stock warning when on-hand quantity reaches this number. For SERIALIZED products it applies to the count of IN_STOCK units.',
    example: 3,
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  lowStockThreshold?: number;

  @ApiPropertyOptional({
    description:
      'Set false to hide the product from pickers without deleting it.',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
