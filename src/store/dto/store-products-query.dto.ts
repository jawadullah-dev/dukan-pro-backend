import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * WF22 step 5 — query for GET /public/stores/:slug/products.
 * `category` / `brand` accept an id (from the categories route) or an exact
 * name; `q` is a case-insensitive contains match on the product name.
 */
export class StoreProductsQueryDto {
  @ApiPropertyOptional({ example: 1, description: '1-based page number.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    example: 20,
    description: 'Rows per page. Maximum 50 (WF22).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;

  @ApiPropertyOptional({
    example: '01924f0a-0000-7000-8000-000000000010',
    description: 'Only products in this category (id or exact name).',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  category?: string;

  @ApiPropertyOptional({
    example: 'Samsung',
    description: 'Only products of this brand (id or exact name).',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  brand?: string;

  @ApiPropertyOptional({
    example: 'a15',
    description: 'Case-insensitive contains search on the product name.',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  q?: string;
}
