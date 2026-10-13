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

export class SupplierQueryFilterDto {
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
    example: 'mobiles',
    description:
      'Case-insensitive contains search across supplier name, phone and address. Supplier names are NOT unique, so a search may return several rows with the same name.',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    example: 'true',
    description:
      '"true" returns only active suppliers. "false" returns only deactivated ones. Omit for both.',
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
      'Field to sort by. name | phone | createdAt | updatedAt | openingBalance | isActive.',
  })
  @IsOptional()
  @IsIn(['name', 'phone', 'createdAt', 'updatedAt', 'openingBalance', 'isActive'])
  sortBy?: 'name' | 'phone' | 'createdAt' | 'updatedAt' | 'openingBalance' | 'isActive' =
    'createdAt';

  @ApiPropertyOptional({ example: 'desc', description: 'asc or desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}
