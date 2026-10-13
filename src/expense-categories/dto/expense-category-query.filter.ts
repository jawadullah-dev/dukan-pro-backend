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

export class ExpenseCategoryQueryFilterDto {
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
    example: 'rent',
    description:
      'Case-insensitive contains search across the expense category name.',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    example: 'true',
    description:
      '"true" returns only active categories. "false" returns only deactivated ones. Omit for both.',
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
    description: 'Field to sort by. name | createdAt | updatedAt.',
  })
  @IsOptional()
  @IsIn(['name', 'createdAt', 'updatedAt'])
  sortBy?: 'name' | 'createdAt' | 'updatedAt' = 'name';

  @ApiPropertyOptional({ example: 'asc', description: 'asc or desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'asc';
}
