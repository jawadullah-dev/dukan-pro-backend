import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class InventoryAdjustmentQueryFilterDto {
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
    example: 'Charger',
    description:
      'Case-insensitive contains search across the product name and the movement reason.',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    example: '01924f0a-0000-7000-8000-000000000101',
    description: 'Only stock changes for this product.',
  })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({
    example: 'DAMAGED',
    description:
      'ADJUSTMENT | DAMAGED | LOST. When omitted the list only shows manual stock changes, never purchase/sale movements.',
  })
  @IsOptional()
  @IsIn(['ADJUSTMENT', 'DAMAGED', 'LOST'])
  type?: 'ADJUSTMENT' | 'DAMAGED' | 'LOST';

  @ApiPropertyOptional({
    example: '2026-10-01',
    description: 'Inclusive lower bound on the movement timestamp, YYYY-MM-DD.',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-10-31',
    description: 'Inclusive upper bound on the movement timestamp, YYYY-MM-DD.',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    example: 'createdAt',
    description: 'createdAt | quantityChange.',
  })
  @IsOptional()
  @IsIn(['createdAt', 'quantityChange'])
  sortBy?: 'createdAt' | 'quantityChange' = 'createdAt';

  @ApiPropertyOptional({ example: 'desc', description: 'asc or desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}
