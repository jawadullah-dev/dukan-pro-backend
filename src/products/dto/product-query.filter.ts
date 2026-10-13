import { ApiPropertyOptional } from '@nestjs/swagger';
import { BadRequestException } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class ProductQueryFilterDto {
  @ApiPropertyOptional({ example: 1, description: '1-based page number.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 10, description: 'Rows per page, max 100.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 10;

  @ApiPropertyOptional({
    example: 'a15',
    description:
      'Case-insensitive contains search across name, model, sku and barcode.',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    example: '01924f0a-0000-7000-8000-000000000000',
    description: 'Only products in this category.',
  })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({
    example: '01924f0a-0000-7000-8000-000000000001',
    description: 'Only products of this brand.',
  })
  @IsOptional()
  @IsString()
  brandId?: string;

  @ApiPropertyOptional({
    example: 'QUANTITY',
    enum: ['QUANTITY', 'SERIALIZED'],
    description: 'Only products tracked this way.',
  })
  @IsOptional()
  @IsIn(['QUANTITY', 'SERIALIZED'])
  trackingType?: 'QUANTITY' | 'SERIALIZED';

  @ApiPropertyOptional({
    example: 'true',
    description:
      '"true" returns only active products. "false" returns only deactivated ones. Omit for both.',
  })
  @IsOptional()
  @Type(() => String)
  @Transform(({ value }) => {
    if (value === undefined || value === null) return undefined;
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    throw new BadRequestException('isActive must be true or false');
  })
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    example: 'name',
    description:
      'Field to sort by. name | createdAt | updatedAt | defaultSellingPrice.',
  })
  @IsOptional()
  @IsIn(['name', 'createdAt', 'updatedAt', 'defaultSellingPrice'])
  sortBy?: 'name' | 'createdAt' | 'updatedAt' | 'defaultSellingPrice' =
    'createdAt';

  @ApiPropertyOptional({ example: 'desc', description: 'asc or desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}
