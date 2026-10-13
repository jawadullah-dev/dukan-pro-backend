import { ApiPropertyOptional } from '@nestjs/swagger';
import { BadRequestException } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
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

export class PurchaseQueryFilterDto {
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
    example: 'AB-771',
    description:
      'Case-insensitive contains search across purchase number, the supplier invoice reference and the supplier name.',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    example: '01924f0a-0000-7000-8000-00000000000a',
    description: 'Only purchases from this supplier.',
  })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({
    example: 'ACTIVE',
    description: 'ACTIVE (default) or CANCELLED. Omit for both.',
  })
  @IsOptional()
  @IsIn(['ACTIVE', 'CANCELLED'])
  status?: 'ACTIVE' | 'CANCELLED';

  @ApiPropertyOptional({
    example: 'true',
    description:
      '"true" returns only opening-stock entries, "false" only real purchases. Omit for both.',
  })
  @IsOptional()
  @Type(() => String)
  @Transform(({ value }) => {
    if (value === undefined || value === null) return undefined;
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    throw new BadRequestException('isOpeningStock must be true or false');
  })
  @IsBoolean()
  isOpeningStock?: boolean;

  @ApiPropertyOptional({
    example: '2026-10-01',
    description: 'Inclusive lower bound on purchaseDate, YYYY-MM-DD.',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-10-31',
    description: 'Inclusive upper bound on purchaseDate, YYYY-MM-DD.',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    example: 'purchaseDate',
    description:
      'purchaseDate | purchaseNo | totalAmount | createdAt | updatedAt.',
  })
  @IsOptional()
  @IsIn(['purchaseDate', 'purchaseNo', 'totalAmount', 'createdAt', 'updatedAt'])
  sortBy?:
    'purchaseDate' | 'purchaseNo' | 'totalAmount' | 'createdAt' | 'updatedAt' =
    'purchaseDate';

  @ApiPropertyOptional({ example: 'desc', description: 'asc or desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}
